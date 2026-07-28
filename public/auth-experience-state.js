import { normalizeEmail, normalizeProvider, sessionSummary } from './auth-account-state.js';

export const AUTH_ROUTES = Object.freeze({
  account: 'cuenta.html',
  login: 'login.html',
  register: 'registro.html',
  verify: 'verificar-email.html',
});

const SOCIAL_PROVIDERS = Object.freeze(['google', 'facebook']);
const AUTH_ROUTE_NAMES = new Set(Object.values(AUTH_ROUTES));

export function normalizeAuthRoute(value) {
  const pathname = String(value ?? '').split(/[?#]/u)[0];
  const file = pathname.split('/').filter(Boolean).at(-1) || AUTH_ROUTES.account;
  return AUTH_ROUTE_NAMES.has(file) ? file : AUTH_ROUTES.account;
}

export function authRouteUrl(publicSiteUrl, route) {
  const normalizedRoute = normalizeAuthRoute(route);
  const base = String(publicSiteUrl ?? '').trim().replace(/\/$/u, '');
  return base ? `${base}/${normalizedRoute}` : `/${normalizedRoute}`;
}

export function sessionProviders(session) {
  const user = session?.user;
  if (!user || typeof user !== 'object') return Object.freeze([]);
  const candidates = [
    user.app_metadata?.provider,
    ...(Array.isArray(user.app_metadata?.providers) ? user.app_metadata.providers : []),
    ...(Array.isArray(user.identities) ? user.identities.map((identity) => identity?.provider) : []),
  ];
  const providers = [];
  for (const candidate of candidates) {
    const provider = normalizeProvider(candidate) || (String(candidate ?? '').toLowerCase() === 'email' ? 'email' : '');
    if (provider && !providers.includes(provider)) providers.push(provider);
  }
  return Object.freeze(providers);
}

export function authIdentity(session) {
  const summary = sessionSummary(session);
  if (!summary) return null;
  const providers = sessionProviders(session);
  const socialProviders = providers.filter((provider) => SOCIAL_PROVIDERS.includes(provider));
  const primaryProvider = providers[0] || summary.provider;
  return Object.freeze({
    email: summary.email,
    emailVerified: summary.emailVerified,
    primaryProvider,
    providers,
    socialProviders: Object.freeze(socialProviders),
    verificationEligible: primaryProvider === 'email'
      && socialProviders.length === 0
      && summary.emailVerified !== true,
  });
}

export function localAccountActive({ accountToken, rememberedNicks, legacyNicks } = {}) {
  const token = String(accountToken ?? '').trim();
  return /^[a-f0-9]{64}$/iu.test(token)
    || (Array.isArray(rememberedNicks) && rememberedNicks.length > 0)
    || (Array.isArray(legacyNicks) && legacyNicks.length > 0);
}

export function resolveAuthExperience({
  route,
  session,
  hasLocalAccount = false,
  pendingEmail,
  hasVerificationToken = false,
} = {}) {
  const currentRoute = normalizeAuthRoute(route);
  const identity = authIdentity(session);
  const pending = normalizeEmail(pendingEmail);

  if ([AUTH_ROUTES.login, AUTH_ROUTES.register].includes(currentRoute)) {
    if (identity || hasLocalAccount) {
      return Object.freeze({ route: currentRoute, redirect: AUTH_ROUTES.account, mode: 'redirect', identity, pendingEmail: pending });
    }
    if (currentRoute === AUTH_ROUTES.register && pending) {
      return Object.freeze({ route: currentRoute, redirect: AUTH_ROUTES.verify, mode: 'redirect', identity, pendingEmail: pending });
    }
    return Object.freeze({
      route: currentRoute,
      redirect: '',
      mode: currentRoute === AUTH_ROUTES.login ? 'login' : 'register',
      identity,
      pendingEmail: pending,
    });
  }

  if (currentRoute === AUTH_ROUTES.verify) {
    if (identity && !identity.verificationEligible) {
      return Object.freeze({ route: currentRoute, redirect: AUTH_ROUTES.account, mode: 'redirect', identity, pendingEmail: pending });
    }
    if (!hasVerificationToken && !pending && !identity?.verificationEligible) {
      return Object.freeze({ route: currentRoute, redirect: AUTH_ROUTES.register, mode: 'redirect', identity, pendingEmail: pending });
    }
    return Object.freeze({
      route: currentRoute,
      redirect: '',
      mode: 'verify',
      identity,
      pendingEmail: pending || identity?.email || '',
    });
  }

  if (identity?.verificationEligible) {
    return Object.freeze({
      route: AUTH_ROUTES.account,
      redirect: '',
      mode: 'pending-email',
      identity,
      pendingEmail: pending || identity.email,
    });
  }

  const mode = identity
    ? 'authenticated'
    : pending
      ? 'pending-email'
      : hasLocalAccount
        ? 'local-link'
        : 'guest';
  return Object.freeze({ route: AUTH_ROUTES.account, redirect: '', mode, identity, pendingEmail: pending });
}

export function providerAction(providerValue, mode, identity = null) {
  const provider = normalizeProvider(providerValue);
  if (!provider) return Object.freeze({ provider: '', disabled: true, label: 'Proveedor no disponible' });
  const name = provider === 'facebook' ? 'Facebook' : 'Google';
  const linked = identity?.providers?.includes(provider) === true;
  if (linked) return Object.freeze({ provider, disabled: true, label: `${name} vinculado` });
  const prefix = mode === 'register' ? 'Crear con' : mode === 'local-link' || mode === 'authenticated' ? 'Vincular' : 'Continuar con';
  return Object.freeze({ provider, disabled: false, label: `${prefix} ${name}` });
}

export function shouldShowEmailVerification(experience) {
  if (!experience || experience.redirect) return false;
  if (experience.mode === 'pending-email' || experience.mode === 'verify') return Boolean(experience.pendingEmail);
  return experience.mode === 'authenticated' && experience.identity?.verificationEligible === true;
}