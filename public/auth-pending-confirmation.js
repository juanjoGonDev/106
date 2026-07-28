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

export function storePendingConfirmation(storage, emailValue, now = Date.now()) {
  const email = normalizeEmail(emailValue);
  if (!email) throw new Error('Introduce un email válido.');
  const availableAt = Number(now) + AUTH_RESEND_COOLDOWN_SECONDS * 1000;
  storage.setItem(AUTH_PENDING_CONFIRMATION_STORAGE_KEY, email);
  storage.setItem(AUTH_RESEND_AVAILABLE_AT_STORAGE_KEY, String(availableAt));
  return Object.freeze({ email, availableAt });
}

export function clearPendingConfirmation(storage) {
  storage?.removeItem?.(AUTH_PENDING_CONFIRMATION_STORAGE_KEY);
  storage?.removeItem?.(AUTH_RESEND_AVAILABLE_AT_STORAGE_KEY);
}
