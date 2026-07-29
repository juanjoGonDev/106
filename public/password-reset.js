import {
  neutralAuthMessage,
  normalizeAuthConfig,
  passwordConfirmationProblem,
  passwordProblems,
  passwordRequirements,
} from './auth-account-state.js';
import { guardAuthRoute, markAuthRouteReady } from './auth-browser-context.js';
import { SupabaseAuthClient } from './supabase-auth-client.js';

const config = normalizeAuthConfig(window.__MINUTO106_CONFIG__);
const status = document.querySelector('#passwordResetStatus');
const password = document.querySelector('#newPassword');
const confirmation = document.querySelector('#confirmNewPassword');
const requirements = document.querySelector('#passwordResetRequirements');
const match = document.querySelector('#passwordResetMatch');
const submit = document.querySelector('#updatePassword');

let client = null;
let sessionReady = false;
let busy = false;

function setStatus(message, tone = 'neutral') {
  status.textContent = message;
  status.dataset.tone = tone;
}

function validationMessage() {
  const problems = passwordProblems(password.value);
  if (problems.length) return problems.join(' ');
  return passwordConfirmationProblem(password.value, confirmation.value);
}

function renderRequirements() {
  const fragment = document.createDocumentFragment();
  for (const requirement of passwordRequirements(password.value)) {
    const item = document.createElement('li');
    item.dataset.met = String(requirement.met);
    item.dataset.requirement = requirement.code;
    item.textContent = requirement.label;
    fragment.append(item);
  }
  requirements.replaceChildren(fragment);

  const confirmationProblem = passwordConfirmationProblem(password.value, confirmation.value);
  if (!confirmation.value) {
    match.textContent = 'Repite la contraseña para confirmar que está bien escrita.';
    match.dataset.valid = 'false';
  } else {
    match.textContent = confirmationProblem || 'Las contraseñas coinciden.';
    match.dataset.valid = String(!confirmationProblem);
  }
}

function refreshValidation() {
  renderRequirements();
  const message = validationMessage();
  submit.disabled = !sessionReady || busy || Boolean(message);
  if (!sessionReady) return;
  setStatus(message || 'La nueva contraseña cumple todos los requisitos.', message ? 'neutral' : 'success');
}

async function initialize() {
  if (!config.available) {
    markAuthRouteReady(document);
    submit.disabled = true;
    const local = ['localhost', '127.0.0.1'].includes(window.location.hostname);
    setStatus(local
      ? 'Supabase local no está listo. Ejecuta pnpm supabase:start y vuelve a cargar.'
      : 'La recuperación por email no está configurada en esta publicación.', 'error');
    renderRequirements();
    return;
  }
  client = new SupabaseAuthClient(config);
  const session = await client.exchangeCallback();
  const guard = await guardAuthRoute({
    client,
    session,
    config: window.__MINUTO106_CONFIG__,
    access: window.Minuto106Access,
    storage: window.localStorage,
    location: window.location,
    document,
  });
  if (guard.redirected) return;
  if (!session) {
    submit.disabled = true;
    setStatus('El enlace de recuperación no es válido o ha caducado.', 'error');
    renderRequirements();
    return;
  }
  sessionReady = true;
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
  busy = true;
  refreshValidation();
  try {
    await client.updatePassword(password.value);
    setStatus('Contraseña actualizada. Ya puedes volver a Mi cuenta.', 'success');
    document.querySelector('#returnToAccount').hidden = false;
  } catch (error) {
    setStatus(error.message || neutralAuthMessage('password'), 'error');
    busy = false;
    refreshValidation();
  }
});

initialize().catch((error) => {
  markAuthRouteReady(document);
  submit.disabled = true;
  setStatus(error.message || 'No se pudo validar el enlace de recuperación.', 'error');
  renderRequirements();
});
