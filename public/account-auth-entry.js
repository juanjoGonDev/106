import { clearPendingConfirmation } from './auth-pending-confirmation.js';

const signOutButton = document.querySelector('#cloudSignOut');
signOutButton?.addEventListener('click', () => {
  clearPendingConfirmation(window.localStorage);
}, { capture: true });

await import('./account-auth.js');
