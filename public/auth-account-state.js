export const AUTH_SESSION_STORAGE_KEY = 'minuto106:supabase-session-v1';
export const AUTH_PKCE_STORAGE_KEY = 'minuto106:supabase-pkce-v1';
export const AUTH_RETURN_STORAGE_KEY = 'minuto106:supabase-return-v1';
export const AUTH_PENDING_CONFIRMATION_STORAGE_KEY = 'minuto106:pending-email-confirmation-v1';
export const AUTH_RESEND_AVAILABLE_AT_STORAGE_KEY = 'minuto106:email-resend-available-at-v1';
export const AUTH_CONFIRMATION_LINK_TTL_SECONDS = 60 * 60;
export const AUTH_RESEND_COOLDOWN_SECONDS = 60;
export const PASSWORD_MIN_LENGTH = 10;

const PROVIDERS = new Set(['google', 'facebook']);
const PASSWORD_REQUIREMENT_DEFINITIONS = Object.freeze([
  Object.freeze({ code: 'length', label: `Al menos ${PASSWORD_MIN_LENGTH} caracteres`, test: (value) => value.length >= PASSWORD_MIN_LENGTH }),
  Object.freeze({ code: 'lowercase', label: 'Una letra minúscula', test: (value) => /[a-z]/.test(value) }),
  Object.freeze({ code: 'uppercase', label: 'Una letra mayúscula', test: (value) => /[A-Z]/.test(value) }),
  Object.freeze({ code: 'number', label: 'Un número', test: (value) => /[0-9]/.test(value) }),
  Object.freeze({ code: 'symbol', label: 'Un símbolo', test: (value) => /[^a-zA-Z0-9]/.test(value) }),
]);

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
  return PROVIDERS.has(provider) ? provider : '';
}

export function passwordRequirements(value) {
  const password = String(value ?? '');
  return PASSWORD_REQUIREMENT_DEFINITIONS.map((requirement) => ({
    code: requirement.code,
    label: requirement.label,
    met: requirement.test(password),
  }));
}

export function passwordProblems(value) {
  return passwordRequirements(value)
    .filter((requirement) => !requirement.met)
    .map((requirement) => requirement.code === 'length'
      ? `Usa al menos ${PASSWORD_MIN_LENGTH} caracteres.`
      : `Añade ${requirement.label.toLocaleLowerCase('es')}.`);
}

export function passwordConfirmationProblem(passwordValue, confirmationValue) {
  const password = String(passwordValue ?? '');
  const confirmation = String(confirmationValue ?? '');
  if (!confirmation) return 'Repite la contraseña para confirmar que está bien escrita.';
  return password === confirmation ? '' : 'Las contraseñas no coinciden.';
}

export function registrationReadiness(emailValue, passwordValue, confirmationValue) {
  const email = normalizeEmail(emailValue);
  const problems = passwordProblems(passwordValue);
  const confirmationProblem = passwordConfirmationProblem(passwordValue, confirmationValue);
  return {
    ready: Boolean(email) && problems.length === 0 && !confirmationProblem,
    email,
    problems,
    confirmationProblem,
  };
}

export function normalizeEmail(value) {
  const email = String(value ?? '').normalize('NFKC').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 320 ? email : '';
}

export function confirmationResendDelaySeconds(availableAtValue, nowValue = Date.now()) {
  const availableAt = Number(availableAtValue);
  const now = Number(nowValue);
  if (!Number.isFinite(availableAt) || !Number.isFinite(now)) return 0;
  return Math.max(0, Math.ceil((availableAt - now) / 1000));
}

export function accountRedirectUrl(publicSiteUrl, page = 'cuenta.html') {
  const base = String(publicSiteUrl ?? '').trim().replace(/\/$/, '');
  return `${base}/${String(page).replace(/^\//, '')}`;
}

export function neutralAuthMessage(operation, errorCode = '') {
  const code = String(errorCode ?? '').toLowerCase();
  if (operation === 'signup') {
    return 'Revisa tu correo y abre el enlace de un solo uso durante la próxima hora. Al confirmarlo recibirás +1 intento diario y el logro Cuenta confirmada. Si la dirección ya estaba registrada, no se realizará ningún cambio.';
  }
  if (operation === 'resend') {
    return 'Si la cuenta sigue pendiente, recibirás un nuevo enlace de activación válido durante 1 hora. Al confirmarlo obtendrás +1 intento diario y el logro Cuenta confirmada.';
  }
  if (operation === 'recovery') {
    return 'Si existe una cuenta asociada, recibirás un correo con los siguientes pasos.';
  }
  if (code.includes('invalid login') || code.includes('invalid_credentials')) {
    return 'El email o la contraseña no son correctos.';
  }
  if (code.includes('email not confirmed')) {
    return 'Confirma tu correo desde el enlace de un solo uso antes de iniciar sesión. Puedes reenviarlo desde esta página.';
  }
  if (code.includes('captcha')) {
    return 'No se pudo completar la verificación anti-bots. Inténtalo de nuevo.';
  }
  if (code.includes('rate') || code.includes('too many')) {
    return 'Demasiados intentos seguidos. Espera un momento.';
  }
  return 'No se pudo completar la autenticación. Inténtalo de nuevo.';
}

export function authRewardMessage(reward) {
  const input = reward && typeof reward === 'object' ? reward : {};
  const source = String(input.source || (input.eligible === true && input.active === true ? 'email_confirmation' : ''));
  const provider = String(input.provider ?? '');
  if (input.granted === true && source === 'email_confirmation') {
    return 'Cuenta confirmada y vinculada. Has recibido +1 intento diario y el logro Cuenta confirmada.';
  }
  if (input.granted === true && source === 'social_link') {
    const providerName = provider === 'facebook' ? 'Facebook' : 'Google';
    return `Cuenta vinculada con ${providerName}. Has recibido +1 intento diario; vincular el otro proveedor no acumula otra bonificación.`;
  }
  if (input.active === true && source === 'email_confirmation') {
    return 'Cuenta vinculada. Tu bonificación de +1 intento diario por email confirmado sigue activa.';
  }
  if (input.active === true && source === 'social_link') {
    return 'Cuenta vinculada. Tu bonificación social de +1 intento diario sigue activa y se comparte entre Google y Facebook.';
  }
  if (input.pendingConfirmation === true) {
    return 'Cuenta vinculada. Confirma el email desde el enlace de un solo uso para recibir +1 intento diario y el logro Cuenta confirmada.';
  }
  return 'Cuenta vinculada. Tu progreso se puede recuperar iniciando sesión.';
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
  const provider = String(user.app_metadata?.provider || 'email').toLowerCase();
  return {
    email: String(user.email ?? ''),
    provider: ['google', 'facebook'].includes(provider) ? provider : 'email',
    emailVerified: Boolean(user.email_confirmed_at),
  };
}
