import {
  neutralAuthMessage,
  normalizeAuthConfig,
  passwordProblems,
} from './auth-account-state.js';
import { SupabaseAuthClient } from './supabase-auth-client.js';

const config = normalizeAuthConfig(window.__MINUTO106_CONFIG__);
const status = document.querySelector('#passwordResetStatus');
const password = document.querySelector('#newPassword');
const confirmation = document.querySelector('#confirmNewPassword');
const submit = document.querySelector('#updatePassword');

let client = null;

function setStatus(message, tone = 'neutral') {
  status.textContent = message;
  status.dataset.tone = tone;
}

function validationMessage() {
  const problems = passwordProblems(password.value);
  if (problems.length) return problems.join(' ');
  if (password.value !== confirmation.value) return 'Las contraseñas no coinciden.';
  return '';
}

function refreshValidation() {
  const message = validationMessage();
  submit.disabled = Boolean(message);
  setStatus(message || 'La nueva contraseña cumple los requisitos de seguridad.', message ? 'neutral' : 'success');
}

async function initialize() {
  if (!config.available) {
    submit.disabled = true;
    setStatus('La recuperación por email no está disponible en este despliegue.', 'error');
    return;
  }
  client = new SupabaseAuthClient(config);
  const session = await client.exchangeCallback();
  if (!session) {
    submit.disabled = true;
    setStatus('El enlace de recuperación no es válido o ha caducado.', 'error');
    return;
  }
  refreshValidation();
}

password.addEventListener('input', refreshValidation);
confirmation.addEventListener('input', refreshValidation);
submit.addEventListener('click', async () => {
  const message = validationMessage();
  if (message) {
    setStatus(message, 'error');
    return;
  }
  submit.disabled = true;
  try {
    await client.updatePassword(password.value);
    setStatus('Contraseña actualizada. Ya puedes volver a Mi cuenta.', 'success');
    document.querySelector('#returnToAccount').hidden = false;
  } catch (error) {
    setStatus(error.message || neutralAuthMessage('password'), 'error');
    submit.disabled = false;
  }
});

initialize().catch((error) => {
  submit.disabled = true;
  setStatus(error.message || 'No se pudo validar el enlace de recuperación.', 'error');
});
