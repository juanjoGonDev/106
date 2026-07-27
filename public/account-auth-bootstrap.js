import {
  AUTH_PENDING_CONFIRMATION_STORAGE_KEY,
  normalizeEmail,
} from './auth-account-state.js';

const emailInput = document.querySelector('#authEmail');
const pendingEmail = normalizeEmail(localStorage.getItem(AUTH_PENDING_CONFIRMATION_STORAGE_KEY));

if (emailInput && pendingEmail && !normalizeEmail(emailInput.value)) {
  emailInput.value = pendingEmail;
}
