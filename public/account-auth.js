import {
  authRewardMessage,
  mergeItemText,
  neutralAuthMessage,
  normalizeAuthConfig,
  normalizeMergeImpact,
} from './auth-account-state.js';
import { browserAuthExperience } from './auth-browser-context.js';
import { AuthCaptcha } from './auth-captcha.js';
import {
  authIdentity,
  identitySupportsPassword,
  providerAction,
  shouldShowEmailVerification,
} from './auth-experience-state.js';
import {
  clearPendingConfirmation,
  pendingConfirmationSnapshot,
  pendingConfirmationView,
  resendPendingConfirmation,
} from './auth-pending-confirmation.js';
import { CloudAccountService } from './cloud-account-service.js';
import { SupabaseAuthClient } from './supabase-auth-client.js';

const config = normalizeAuthConfig(window.__MINUTO106_CONFIG__);
const elements = {
  panel: document.querySelector('#cloudAccountPanel'),
  status: document.querySelector('#cloudAccountStatus'),
  guest: document.querySelector('#cloudGuestPanel'),
  localLink: document.querySelector('#cloudLocalLinkPanel'),
  pending: document.querySelector('#cloudPendingPanel'),
  authenticated: document.querySelector('#cloudAuthenticatedPanel'),
  identity: document.querySelector('#cloudAccountIdentity'),
  pendingEmail: document.querySelector('#pendingConfirmationEmail'),
  resend: document.querySelector('#emailConfirmationResend'),
  resendStatus: document.querySelector('#emailConfirmationResendStatus'),
  captcha: document.querySelector('#authCaptcha'),
  localGoogle: document.querySelector('#googleSignIn'),
  authenticatedGoogle: document.querySelector('#authenticatedGoogle'),
  changePassword: document.querySelector('#changePasswordLink'),
  signOut: document.querySelector('#cloudSignOut'),
  mergeDialog: document.querySelector('#accountMergeDialog'),
  mergeSummary: document.querySelector('#accountMergeSummary'),
  mergeSections: document.querySelector('#accountMergeSections'),
  mergeConfirm: document.querySelector('#confirmAccountMerge'),
  mergeCancel: document.querySelector('#cancelAccountMerge'),
};

let client = null;
let service = null;
let captcha = null;
let currentSession = null;
let currentExperience = null;
let pendingMerge = null;
let confirmingMerge = false;
let resendTimer = null;
let busy = false;

function setStatus(message, tone = 'neutral') {
  if (!elements.status) return;
  elements.status.textContent = message;
  elements.status.dataset.tone = tone;
}

function setBusy(value) {
  busy = value;
  if (elements.panel) elements.panel.dataset.busy = String(value);
  renderExperience();
}

function setPanelVisibility(element, visible) {
  if (element) element.hidden = !visible;
}

function providerName(provider) {
  return provider === 'google' ? 'Google' : 'Email';
}

function renderProviderButton(button, mode, identity) {
  if (!button) return;
  const action = providerAction('google', mode, identity);
  button.textContent = action.label;
  button.disabled = busy || !config.available || action.disabled;
}

function renderIdentity(identity) {
  if (!elements.identity) return;
  elements.identity.replaceChildren();
  if (!identity) return;
  const strong = document.createElement('strong');
  strong.textContent = identity.email || 'Cuenta verificada';
  const providers = document.createElement('span');
  providers.textContent = `Acceso: ${identity.providers.map(providerName).join(', ') || providerName(identity.primaryProvider)}`;
  elements.identity.append(strong, providers);
}

function manageResendTimer(delaySeconds) {
  if (delaySeconds > 0 && resendTimer === null) {
    resendTimer = window.setInterval(renderPendingConfirmation, 1000);
    return;
  }
  if (delaySeconds === 0 && resendTimer !== null) {
    window.clearInterval(resendTimer);
    resendTimer = null;
  }
}

function renderPendingConfirmation() {
  const view = pendingConfirmationView(pendingConfirmationSnapshot(localStorage));
  if (elements.pendingEmail) elements.pendingEmail.textContent = view.emailText;
  if (elements.resend) elements.resend.disabled = busy || !config.available || !view.resendAvailable;
  if (elements.resendStatus) {
    elements.resendStatus.textContent = view.resendStatus;
    elements.resendStatus.dataset.tone = view.resendTone;
  }
  manageResendTimer(view.resendDelaySeconds);
}

function renderExperience() {
  if (!currentExperience) return;
  const mode = currentExperience.mode;
  const identity = currentExperience.identity;
  const verificationVisible = shouldShowEmailVerification(currentExperience);
  setPanelVisibility(elements.guest, mode === 'guest');
  setPanelVisibility(elements.localLink, mode === 'local-link');
  setPanelVisibility(elements.authenticated, mode === 'authenticated');
  setPanelVisibility(elements.pending, mode === 'pending-email' || verificationVisible);

  renderPendingConfirmation();
  renderIdentity(identity);
  renderProviderButton(elements.localGoogle, 'local-link', identity);
  renderProviderButton(elements.authenticatedGoogle, 'authenticated', identity);
  if (elements.changePassword) {
    elements.changePassword.hidden = mode !== 'authenticated' || !identitySupportsPassword(identity);
    elements.changePassword.setAttribute('aria-disabled', String(busy));
  }
  if (elements.signOut) elements.signOut.disabled = busy || !config.available;
}

function impactHeading(item) {
  if (item.title) return item.title;
  if (item.name) return item.name;
  if (item.challenger && item.opponent) return 'Duelo entre cuentas vinculadas';
  if (item.referrer && item.referred) return 'Referido entre cuentas vinculadas';
  return 'Corrección competitiva';
}

function renderMergeImpact(impact) {
  const normalized = normalizeMergeImpact(impact);
  elements.mergeSections?.replaceChildren();
  for (const section of normalized.sections) {
    if (!section.items.length) continue;
    const group = document.createElement('section');
    group.className = 'merge-impact-group';
    const title = document.createElement('h3');
    title.textContent = section.title;
    const list = document.createElement('ul');
    for (const item of section.items) {
      const row = document.createElement('li');
      const strong = document.createElement('strong');
      strong.textContent = impactHeading(item);
      const detail = document.createElement('span');
      detail.textContent = mergeItemText(item);
      row.append(strong, detail);
      list.append(row);
    }
    group.append(title, list);
    elements.mergeSections?.append(group);
  }
  if (elements.mergeSummary) {
    const label = normalized.totalLosses === 1 ? 'consecuencia competitiva' : 'consecuencias competitivas';
    elements.mergeSummary.textContent = `${normalized.totalLosses} ${label} antes de unificar las cuentas.`;
  }
}

function showMerge(payload) {
  pendingMerge = {
    proposalId: payload.proposalId,
    fingerprint: payload.fingerprint,
  };
  renderMergeImpact(payload.impact);
  elements.mergeDialog?.showModal();
  elements.mergeConfirm?.focus();
}

async function cancelPendingMerge() {
  if (!pendingMerge || confirmingMerge) return;
  const proposal = pendingMerge;
  pendingMerge = null;
  await service.cancelMerge(proposal.proposalId).catch(() => {});
}

async function refreshExperience() {
  currentSession = client ? await client.currentSession() : null;
  currentExperience = await browserAuthExperience({
    client,
    config: window.__MINUTO106_CONFIG__,
    access: window.Minuto106Access,
  });
  const identity = authIdentity(currentSession);
  if (identity && !identity.verificationEligible) clearPendingConfirmation(localStorage);
  renderExperience();
  return currentExperience;
}

async function synchronizeAccount() {
  if (!currentSession) return null;
  setStatus('Sincronizando tu progreso con la cuenta…');
  const result = await service.synchronize();
  if (result.mergeRequired) {
    showMerge(result);
    setStatus('Revisa las consecuencias antes de vincular las cuentas.', 'warning');
    return result;
  }
  document.dispatchEvent(new CustomEvent('minuto106:cloud-account-synced'));
  setStatus(authRewardMessage(result.authReward || result.verificationReward), 'success');
  await refreshExperience();
  return result;
}

async function withOperation(action) {
  setBusy(true);
  try {
    await action();
  } catch (error) {
    setStatus(error.message || 'No se pudo completar la operación.', 'error');
  } finally {
    captcha?.reset();
    setBusy(false);
  }
}

async function startOAuth() {
  await client.signInWithOAuth('google', { returnPage: 'cuenta.html' });
}

async function resendConfirmation() {
  await resendPendingConfirmation({ client, captcha, storage: localStorage });
  setStatus(neutralAuthMessage('resend'), 'success');
  renderPendingConfirmation();
}

async function confirmCompleteSignOut() {
  return window.Minuto106UI?.ask({
    title: 'Cerrar sesión en este dispositivo',
    message: 'Se cerrará la sesión en la nube y se eliminarán de este navegador la clave privada y los accesos locales. Podrás volver a entrar con email o Google.',
    acceptLabel: 'Cerrar sesión',
    cancelLabel: 'Cancelar',
  }) ?? false;
}

async function completeSignOut() {
  if (!await confirmCompleteSignOut()) return;
  const result = await client.signOut();
  clearPendingConfirmation(localStorage);
  window.Minuto106Access?.clearAccountSession?.();
  currentSession = null;
  await refreshExperience();
  document.dispatchEvent(new CustomEvent('minuto106:cloud-account-synced'));
  if (result.remoteRevoked) {
    setStatus('Sesión cerrada por completo. Ya puedes iniciar sesión o crear otra cuenta.', 'success');
    return;
  }
  setStatus('Sesión local cerrada. No se pudo confirmar la revocación remota; cambia la contraseña si sospechas que otra persona conserva acceso.', 'warning');
}

function bindProvider(button) {
  button?.addEventListener('click', () => withOperation(startOAuth));
}

async function initialize() {
  if (!config.available) {
    currentExperience = await browserAuthExperience({
      client: null,
      config: window.__MINUTO106_CONFIG__,
      access: window.Minuto106Access,
    });
    renderExperience();
    setStatus('La cuenta local sigue disponible, pero la autenticación en la nube no está configurada en este entorno.', 'warning');
    return;
  }

  client = new SupabaseAuthClient(config);
  service = new CloudAccountService(config, client);
  captcha = new AuthCaptcha(config.turnstileSiteKey, elements.captcha);
  currentSession = await client.exchangeCallback();
  await refreshExperience();

  if (currentSession && !authIdentity(currentSession)) {
    client.clearAuthenticationState();
    currentSession = null;
    await refreshExperience();
    setStatus('La sesión guardada usa un proveedor no compatible. Inicia sesión con Google o email.', 'warning');
    return;
  }

  const snapshot = pendingConfirmationSnapshot(localStorage);
  if (currentSession) {
    await synchronizeAccount();
    return;
  }
  if (currentExperience.mode === 'local-link') {
    setStatus('Vincula esta cuenta local con Google. No necesitas volver a registrarte.');
    return;
  }
  if (currentExperience.mode === 'pending-email') {
    setStatus(`La cuenta ${snapshot.email} aún no está verificada. Confírmala para recibir +1 intento diario.`, 'warning');
    return;
  }
  setStatus('Inicia sesión o crea una cuenta para recuperar tus nicks en otros dispositivos.');
}

bindProvider(elements.localGoogle);
bindProvider(elements.authenticatedGoogle);

elements.resend?.addEventListener('click', () => withOperation(resendConfirmation));
elements.signOut?.addEventListener('click', () => withOperation(completeSignOut));

elements.mergeConfirm?.addEventListener('click', () => withOperation(async () => {
  if (!pendingMerge) return;
  confirmingMerge = true;
  try {
    const result = await service.confirmMerge(pendingMerge);
    pendingMerge = null;
    elements.mergeDialog?.close();
    document.dispatchEvent(new CustomEvent('minuto106:cloud-account-synced'));
    const corrections = normalizeMergeImpact(result.impact).totalLosses;
    const reward = authRewardMessage(result.authReward || result.verificationReward);
    setStatus(`Cuentas vinculadas. Se aplicaron ${corrections} correcciones competitivas. ${reward}`, 'success');
    await refreshExperience();
  } finally {
    confirmingMerge = false;
  }
}));

elements.mergeCancel?.addEventListener('click', () => elements.mergeDialog?.close());
elements.mergeDialog?.addEventListener('close', () => cancelPendingMerge().catch(() => {}));
window.addEventListener('pagehide', () => {
  if (resendTimer !== null) window.clearInterval(resendTimer);
});

initialize().catch((error) => {
  setStatus(error.message || 'No se pudo iniciar la autenticación.', 'error');
});
