import {
  neutralAuthMessage,
  normalizeAuthConfig,
  passwordConfirmationProblem,
  passwordRequirements,
} from './auth-account-state.js';
import { guardAuthRoute, markAuthRouteReady } from './auth-browser-context.js';
import {
  PASSWORD_PAGE_MODES,
  hasPasswordCallback,
  isPasswordChangeRequest,
  passwordPageContent,
  passwordUpdateProblem,
  resolvePasswordPageMode,
} from './password-page-state.js';
import { SupabaseAuthClient } from './supabase-auth-client.js';

const config = normalizeAuthConfig(window.__MINUTO106_CONFIG__);
const shell = document.querySelector('[data-auth-shell]');
const eyebrow = document.querySelector('#passwordResetEyebrow');
const title = document.querySelector('#passwordResetTitle');
const lead = document.querySelector('#passwordResetLead');
const status = document.querySelector('#passwordResetStatus');
const currentField = document.querySelector('#currentPasswordField');
const currentPassword = document.querySelector('#currentPassword');
const password = document.querySelector('#newPassword');
const confirmation = document.querySelector('#confirmNewPassword');
const requirements = document.querySelector('#passwordResetRequirements');
const match = document.querySelector('#passwordResetMatch');
const submit = document.querySelector('#updatePassword');
const returnToAccount = document.querySelector('#returnToAccount');

let client = null;
let mode = PASSWORD_PAGE_MODES.unavailable;
let sessionReady = false;
let busy = false;

function setStatus(message, tone = 'neutral') {
  status.textContent = message;
  status.dataset.tone = tone;
}

function content() {
  return passwordPageContent(mode);
}

function renderMode() {
  const view = content();
  shell.dataset.passwordMode = mode;
  eyebrow.textContent = view.eyebrow;
  title.textContent = view.title;
  lead.textContent = view.lead;
  currentField.hidden = !view.currentPasswordVisible;
  submit.textContent = view.submitLabel;
  document.title = `${view.title} — Minuto 106`;
}

function validationMessage() {
  return passwordUpdateProblem({
    mode,
    currentPassword: currentPassword.value,
    password: password.value,
    confirmation: confirmation.value,
  });
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
  setStatus(message || content().readyMessage, message ? 'neutral' : 'success');
}

async function initialize() {
  if (!config.available) {
    markAuthRouteReady(document);
    submit.disabled = true;
    const local = ['localhost', '127.0.0.1'].includes(window.location.hostname);
    setStatus(local
      ? 'Supabase local no está listo. Ejecuta pnpm supabase:start y vuelve a cargar.'
      : 'La gestión de contraseña no está configurada en esta publicación.', 'error');
    renderMode();
    renderRequirements();
    return;
  }

  client = new SupabaseAuthClient(config);
  const hadSessionBeforeExchange = Boolean(client.readSession());
  const callbackPresent = hasPasswordCallback(window.location.href);
  const changeRequested = isPasswordChangeRequest(window.location.href);
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

  mode = resolvePasswordPageMode({
    hadSessionBeforeExchange,
    callbackPresent,
    changeRequested,
    session,
  });
  renderMode();
  if (mode === PASSWORD_PAGE_MODES.unavailable) {
    submit.disabled = true;
    setStatus('La sesión para gestionar la contraseña no es válida o ha caducado.', 'error');
    renderRequirements();
    return;
  }

  sessionReady = true;
  refreshValidation();
}

currentPassword.addEventListener('input', refreshValidation);
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
    await client.updatePassword(password.value, {
      currentPassword: mode === PASSWORD_PAGE_MODES.change ? currentPassword.value : '',
    });
    setStatus(content().successMessage, 'success');
    returnToAccount.hidden = false;
  } catch (error) {
    setStatus(error.message || neutralAuthMessage('password'), 'error');
    busy = false;
    refreshValidation();
  }
});

initialize().catch((error) => {
  markAuthRouteReady(document);
  submit.disabled = true;
  setStatus(error.message || 'No se pudo validar la sesión para gestionar la contraseña.', 'error');
  renderMode();
  renderRequirements();
});
