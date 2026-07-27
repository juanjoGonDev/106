export const AUTH_SESSION_STORAGE_KEY = 'minuto106:supabase-session-v1';
export const AUTH_PKCE_STORAGE_KEY = 'minuto106:supabase-pkce-v1';
export const AUTH_RETURN_STORAGE_KEY = 'minuto106:supabase-return-v1';

const OAUTH_PROVIDERS = new Set(['google', 'facebook', 'apple', 'x']);
const AUTH_PROVIDERS = new Set(['email', ...OAUTH_PROVIDERS]);
const PROVIDER_LABELS = {
  email: 'email',
  google: 'Google',
  facebook: 'Facebook',
  apple: 'Apple',
  x: 'X',
};

export function normalizeAuthConfig(value) {
  const input = value && typeof value === 'object' ? value : {};
  const supabaseUrl = String(input.supabaseUrl ?? '').trim().replace(/\/$/, '');
  const publishableKey = String(input.supabasePublishableKey ?? '').trim();
  const accountAuthApiUrl = String(input.accountAuthApiUrl ?? '').trim().replace(/\/$/, '');
  const publicSiteUrl = String(input.publicSiteUrl ?? '').trim().replace(/\/$/, '');
  const validUrl = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(supabaseUrl)
    || /^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/i.test(supabaseUrl);
  const validKey = /^sb_publishable_[a-zA-Z0-9_-]{20,}$/.test(publishableKey)
    || /^eyJ[a-zA-Z0-9._-]{20,}$/.test(publishableKey);
  return {
    available: validUrl && validKey && Boolean(accountAuthApiUrl),
    supabaseUrl,
    publishableKey,
    accountAuthApiUrl,
    publicSiteUrl,
    turnstileSiteKey: String(input.turnstileSiteKey ?? '').trim(),
  };
}

export function normalizeProvider(value) {
  const provider = String(value ?? '').trim().toLowerCase();
  return OAUTH_PROVIDERS.has(provider) ? provider : '';
}

export function providerLabel(value) {
  const provider = String(value ?? '').trim().toLowerCase();
  return PROVIDER_LABELS[provider] ?? PROVIDER_LABELS.email;
}

export function passwordProblems(value) {
  const password = String(value ?? '');
  const problems = [];
  if (password.length < 12) problems.push('Usa al menos 12 caracteres.');
  if (!/[a-z]/.test(password)) problems.push('Añade una letra minúscula.');
  if (!/[A-Z]/.test(password)) problems.push('Añade una letra mayúscula.');
  if (!/[0-9]/.test(password)) problems.push('Añade un número.');
  if (!/[^a-zA-Z0-9]/.test(password)) problems.push('Añade un símbolo.');
  return problems;
}

export function normalizeEmail(value) {
  const email = String(value ?? '').normalize('NFKC').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 320 ? email : '';
}

export function accountRedirectUrl(publicSiteUrl, page = 'cuenta.html') {
  const base = String(publicSiteUrl ?? '').trim().replace(/\/$/, '');
  return `${base}/${String(page).replace(/^\//, '')}`;
}

export function neutralAuthMessage(operation, errorCode = '') {
  const code = String(errorCode ?? '').toLowerCase();
  if (operation === 'signup') {
    return 'Revisa tu correo para confirmar la cuenta. Si la dirección ya estaba registrada, no se realizará ningún cambio.';
  }
  if (operation === 'recovery') {
    return 'Si existe una cuenta asociada, recibirás un correo con los siguientes pasos.';
  }
  if (code.includes('invalid login') || code.includes('invalid_credentials')) {
    return 'El email o la contraseña no son correctos.';
  }
  if (code.includes('email not confirmed')) {
    return 'Confirma tu correo antes de iniciar sesión.';
  }
  if (code.includes('captcha')) {
    return 'No se pudo completar la verificación anti-bots. Inténtalo de nuevo.';
  }
  if (code.includes('rate') || code.includes('too many')) {
    return 'Demasiados intentos seguidos. Espera un momento.';
  }
  return 'No se pudo completar la autenticación. Inténtalo de nuevo.';
}

function normalizedList(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') : [];
}

export function normalizeMergeImpact(value) {
  const input = value && typeof value === 'object' ? value : {};
  const sections = [
    ['Ligas invalidadas', normalizedList(input.leagues)],
    ['Trofeos retirados', normalizedList(input.trophies)],
    ['Logros retirados', normalizedList(input.achievements)],
    ['Duelos invalidados', normalizedList(input.duels)],
    ['Referidos invalidados', normalizedList(input.referrals)],
    ['Intentos extra corregidos', normalizedList(input.bonusAdjustments)],
  ].map(([title, items]) => ({ title, items }));
  const counted = sections.reduce((total, section) => total + section.items.length, 0);
  const totalLosses = Number.isInteger(Number(input.totalLosses))
    ? Math.max(0, Number(input.totalLosses))
    : counted;
  return { sections, totalLosses };
}

export function mergeItemText(item) {
  if (item.title && item.nick) return `${item.title} · ${item.nick}`;
  if (item.name && item.publicId) return `${item.name} · ${item.publicId}`;
  if (item.challenger && item.opponent) return `${item.challenger} contra ${item.opponent}`;
  if (item.referrer && item.referred) return `${item.referrer} invitó a ${item.referred}`;
  if (item.nick && Number.isFinite(Number(item.attempts))) {
    return `${item.nick}: −${Number(item.attempts)} intentos extra`;
  }
  return String(item.title || item.name || item.code || item.id || 'Elemento competitivo');
}

export function sessionSummary(session) {
  const user = session?.user;
  if (!user || typeof user !== 'object') return null;
  const candidate = String(user.app_metadata?.provider || 'email').toLowerCase();
  const provider = AUTH_PROVIDERS.has(candidate) ? candidate : 'email';
  return {
    email: String(user.email ?? ''),
    provider,
    emailVerified: Boolean(user.email_confirmed_at),
  };
}
