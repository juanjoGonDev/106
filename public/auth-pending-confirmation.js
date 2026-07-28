import {
  AUTH_PENDING_CONFIRMATION_STORAGE_KEY,
  AUTH_RESEND_AVAILABLE_AT_STORAGE_KEY,
  AUTH_RESEND_COOLDOWN_SECONDS,
  confirmationResendDelaySeconds,
  normalizeEmail,
} from './auth-account-state.js';

export function pendingConfirmationEmail(storage) {
  return normalizeEmail(storage?.getItem?.(AUTH_PENDING_CONFIRMATION_STORAGE_KEY));
}

export function pendingConfirmationSnapshot(storage, now = Date.now()) {
  const email = pendingConfirmationEmail(storage);
  const availableAt = Number(storage?.getItem?.(AUTH_RESEND_AVAILABLE_AT_STORAGE_KEY) || 0);
  return Object.freeze({
    email,
    availableAt: Number.isFinite(availableAt) ? availableAt : 0,
    resendDelaySeconds: confirmationResendDelaySeconds(availableAt, now),
  });
}

export function pendingConfirmationView(snapshotValue) {
  const snapshot = snapshotValue && typeof snapshotValue === 'object' ? snapshotValue : {};
  const email = normalizeEmail(snapshot.email);
  const resendDelaySeconds = Math.max(0, Math.ceil(Number(snapshot.resendDelaySeconds) || 0));
  return Object.freeze({
    email,
    emailText: email ? `Activación pendiente para ${email}` : '',
    resendAvailable: Boolean(email) && resendDelaySeconds === 0,
    resendDelaySeconds,
    resendStatus: resendDelaySeconds > 0
      ? `Podrás solicitar otro código en ${resendDelaySeconds} s.`
      : email
        ? 'El nuevo código y enlace serán válidos durante 1 hora.'
        : 'No se encontró un email pendiente.',
    resendTone: resendDelaySeconds > 0 ? 'warning' : 'neutral',
  });
}

export function storePendingConfirmation(storage, emailValue, now = Date.now()) {
  const email = normalizeEmail(emailValue);
  if (!email) throw new Error('Introduce un email válido.');
  const availableAt = Number(now) + AUTH_RESEND_COOLDOWN_SECONDS * 1000;
  storage.setItem(AUTH_PENDING_CONFIRMATION_STORAGE_KEY, email);
  storage.setItem(AUTH_RESEND_AVAILABLE_AT_STORAGE_KEY, String(availableAt));
  return Object.freeze({ email, availableAt });
}

export async function resendPendingConfirmation({ client, captcha, storage, now = Date.now() } = {}) {
  const snapshot = pendingConfirmationSnapshot(storage, now);
  if (!snapshot.email) throw new Error('No se encontró el email pendiente de verificación.');
  if (snapshot.resendDelaySeconds > 0) throw new Error('Espera antes de solicitar otro código.');
  const captchaToken = await captcha.token();
  await client.resendSignupConfirmation(snapshot.email, { captchaToken });
  storePendingConfirmation(storage, snapshot.email, now);
  return pendingConfirmationSnapshot(storage, now);
}

export function clearPendingConfirmation(storage) {
  storage?.removeItem?.(AUTH_PENDING_CONFIRMATION_STORAGE_KEY);
  storage?.removeItem?.(AUTH_RESEND_AVAILABLE_AT_STORAGE_KEY);
}
