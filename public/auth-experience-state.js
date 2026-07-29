import { normalizeEmail, normalizeProvider, sessionSummary } from './auth-account-state.js';

export const AUTH_ROUTES = Object.freeze({
  account: 'cuenta.html',
  login: 'login.html',
  register: 'registro.html',
  reset: 'restablecer-clave.html',
  verify: 'verificar-email.html',
});

export const AUTH_ROUTE_ACCESS = Object.freeze({
  contextual: 'contextual',
  guestOnly: 'guest-only',
  recoverySession: 'recovery-session',
  verification: 'verification',
});

const routePolicy = (access, redirects = {}) => Object.freeze({ access, ...redirects });

export const AUTH_ROUTE_POLICIES = Object.freeze({
  [AUTH_ROUTES.account]: routePolicy(AUTH_ROUTE_ACCESS.contextual),
  [AUTH_ROUTES.login]: routePolicy(AUTH_ROUTE_ACCESS.guestOnly, {
    authenticatedRedirect: AUTH_ROUTES.account,
  }),
  [AUTH_ROUTES.register]: routePolicy(AUTH_ROUTE_ACCESS.guestOnly, {
    authenticatedRedirect: AUTH_ROUTES.account,
    pendingRedirect: AUTH_ROUTES.verify,
  }),
  [AUTH_ROUTES.reset]: routePolicy(AUTH_ROUTE_ACCESS.recoverySession, {
    missingRedirect: AUTH_ROUTES.login,
  }),
  [AUTH_ROUTES.verify]: routePolicy(AUTH_ROUTE_ACCESS.verification, {
    missingRedirect: AUTH_ROUTES.register,
    verifiedRedirect: AUTH_ROUTES.account,
  }),
});

const SOCIAL_PROVIDERS = Object.freeze(['google', 'facebook']);
const AUTH_ROUTE_NAMES = new Set(Object.values(AUTH_ROUTES));

export function normalizeAuthRoute(value) {
  const pathname = String(value ?? '').split(/[?#]/u)[0];
  const file = pathname.split('/').filter(Boolean).at(-1) || AUTH_ROUTES.account;
  return AUTH_ROUTE_NAMES.has(file) ? file : AUTH_ROUTES.account;
}

export function authRoutePolicy(value) {
  return AUTH_ROUTE_POLICIES[normalizeAuthRoute(value)];
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

export function authRouteGuardDecision({
  route,
  session,
  hasLocalAccount = false,
  pendingEmail,
  hasVerificationToken = false,
} = {}) {
  const currentRoute = normalizeAuthRoute(route);
  const policy = authRoutePolicy(currentRoute);
  const identity = authIdentity(session);
  const pending = normalizeEmail(pendingEmail);
  let redirect = '';

  if (policy.access === AUTH_ROUTE_ACCESS.guestOnly) {
    if (identity || hasLocalAccount) redirect = policy.authenticatedRedirect;
    else if (pending && policy.pendingRedirect) redirect = policy.pendingRedirect;
  } else if (policy.access === AUTH_ROUTE_ACCESS.verification) {
    if (identity && !identity.verificationEligible) redirect = policy.verifiedRedirect;
    else if (!hasVerificationToken && !pending && !identity?.verificationEligible) redirect = policy.missingRedirect;
  } else if (policy.access === AUTH_ROUTE_ACCESS.recoverySession && !identity) {
    redirect = policy.missingRedirect;
  }

  return Object.freeze({
    route: currentRoute,
    redirect: redirect || '',
    identity,
    pendingEmail: pending,
  });
}

export function resolveAuthExperience(input = {}) {
  const guard = authRouteGuardDecision(input);
  const currentRoute = guard.route;
  const identity = guard.identity;
  const pending = guard.pendingEmail;

  if (guard.redirect) {
    return Object.freeze({
      route: currentRoute,
      redirect: guard.redirect,
      mode: 'redirect',
      identity,
      pendingEmail: pending,
    });
  }

  if ([AUTH_ROUTES.login, AUTH_ROUTES.register].includes(currentRoute)) {
    return Object.freeze({
      route: currentRoute,
      redirect: '',
      mode: currentRoute === AUTH_ROUTES.login ? 'login' : 'register',
      identity,
      pendingEmail: pending,
    });
  }

  if (currentRoute === AUTH_ROUTES.verify) {
    return Object.freeze({
      route: currentRoute,
      redirect: '',
      mode: 'verify',
      identity,
      pendingEmail: pending || identity?.email || '',
    });
  }

  if (currentRoute === AUTH_ROUTES.reset) {
    return Object.freeze({
      route: currentRoute,
      redirect: '',
      mode: 'password-reset',
      identity,
      pendingEmail: pending,
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
