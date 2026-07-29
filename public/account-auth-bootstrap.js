import {
  AUTH_PENDING_CONFIRMATION_STORAGE_KEY,
  normalizeEmail,
} from './auth-account-state.js';

export function restorePendingActivationEmail(input, pendingValue) {
  if (!input) return '';
  const currentEmail = normalizeEmail(input.value);
  if (currentEmail) return currentEmail;
  const pendingEmail = normalizeEmail(pendingValue);
  if (!pendingEmail) return '';
  input.value = pendingEmail;
  return pendingEmail;
}

restorePendingActivationEmail(
  document.querySelector('#authEmail'),
  localStorage.getItem(AUTH_PENDING_CONFIRMATION_STORAGE_KEY),
);
