const PRIVATE_TOKEN = /^[a-f0-9]{64}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEVICE_ID = /^[a-zA-Z0-9._:-]{16,80}$/;
const SUPPORTED_PROVIDERS = new Set(['email', 'google']);
const SUPPORTED_ACTIONS = new Set(['session', 'sync-account', 'confirm-merge', 'cancel-merge']);

export function normalizeAction(value) {
  const action = String(value ?? '').trim();
  return SUPPORTED_ACTIONS.has(action) ? action : '';
}

export function bearerToken(value) {
  const match = String(value ?? '').match(/^Bearer\s+([^\s]+)$/i);
  return match ? match[1] : '';
}

export function normalizePrivateToken(value) {
  const token = String(value ?? '').trim().toLowerCase();
  return PRIVATE_TOKEN.test(token) ? token : '';
}

export function normalizeDeviceId(value) {
  const deviceId = String(value ?? '').trim();
  return DEVICE_ID.test(deviceId) ? deviceId : '';
}

export function normalizeUuid(value) {
  const id = String(value ?? '').trim().toLowerCase();
  return UUID.test(id) ? id : '';
}

export function normalizeFingerprint(value) {
  const fingerprint = String(value ?? '').trim().toLowerCase();
  return PRIVATE_TOKEN.test(fingerprint) ? fingerprint : '';
}

export function normalizeProvider(value) {
  const provider = String(value ?? '').trim().toLowerCase();
  return SUPPORTED_PROVIDERS.has(provider) ? provider : '';
}

export function normalizeEmail(value) {
  const email = String(value ?? '').normalize('NFKC').trim().slice(0, 320);
  return email.includes('@') ? email : '';
}

export function authIdentity(user) {
  if (!user || typeof user !== 'object') return null;
  const id = normalizeUuid(user.id);
  const provider = normalizeProvider(user.app_metadata?.provider);
  if (!id || !provider) return null;
  const email = normalizeEmail(user.email);
  const emailVerified = Boolean(user.email_confirmed_at);
  return { id, provider, email, emailVerified };
}

export function errorStatus(code) {
  if (['invalid_input', 'merge_proposal_mismatch'].includes(code)) return 400;
  if (['auth_required', 'invalid_session'].includes(code)) return 401;
  if (['merge_proposal_not_found'].includes(code)) return 404;
  if (['merge_proposal_expired', 'merge_proposal_cancelled', 'merge_proposal_stale'].includes(code)) return 409;
  return 400;
}

export function errorMessage(code) {
  const messages = {
    invalid_input: 'Los datos de autenticación no son válidos.',
    auth_required: 'Inicia sesión para continuar.',
    invalid_session: 'La sesión ha caducado o no es válida.',
    account_not_found: 'No se encontró la cuenta de juego.',
    merge_proposal_not_found: 'La propuesta de vinculación no existe.',
    merge_proposal_expired: 'La propuesta ha caducado. Vuelve a iniciar la vinculación.',
    merge_proposal_cancelled: 'La propuesta ya fue cancelada.',
    merge_proposal_mismatch: 'La confirmación no coincide con el análisis mostrado.',
    merge_proposal_stale: 'Los datos cambiaron antes de confirmar. Revisa el análisis actualizado.',
  };
  return messages[code] ?? 'No se pudo completar la vinculación de la cuenta.';
}

export function publicAuth(identity) {
  return {
    provider: identity.provider,
    email: identity.email,
    emailVerified: identity.emailVerified,
  };
}

export function successfulSync(result, rawToken, identity) {
  const response = {
    ...result,
    auth: publicAuth(identity),
  };
  if (result?.issueToken === true) response.accountToken = rawToken;
  return response;
}
