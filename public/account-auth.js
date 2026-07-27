import {
  AUTH_PENDING_CONFIRMATION_STORAGE_KEY,
  AUTH_RESEND_AVAILABLE_AT_STORAGE_KEY,
  AUTH_RESEND_COOLDOWN_SECONDS,
  authRewardMessage,
  confirmationResendDelaySeconds,
  mergeItemText,
  neutralAuthMessage,
  normalizeAuthConfig,
  normalizeEmail,
  normalizeMergeImpact,
  passwordConfirmationProblem,
  passwordRequirements,
  registrationReadiness,
  sessionSummary,
} from './auth-account-state.js';
import { SupabaseAuthClient } from './supabase-auth-client.js';

const config = normalizeAuthConfig(window.__MINUTO106_CONFIG__);
const deviceStorageKey = 'minuto106:device-id';
const deviceId = localStorage.getItem(deviceStorageKey) || crypto.randomUUID();
localStorage.setItem(deviceStorageKey, deviceId);

const elements = {
  panel: document.querySelector('#cloudAccountPanel'),
  status: document.querySelector('#cloudAccountStatus'),
  identity: document.querySelector('#cloudAccountIdentity'),
  google: document.querySelector('#googleSignIn'),
  facebook: document.querySelector('#facebookSignIn'),
  email: document.querySelector('#authEmail'),
  password: document.querySelector('#authPassword'),
  passwordConfirmation: document.querySelector('#authPasswordConfirmation'),
  passwordRequirements: document.querySelector('#authPasswordRequirements'),
  passwordMatch: document.querySelector('#authPasswordMatch'),
  signIn: document.querySelector('#emailSignIn'),
  signUp: document.querySelector('#emailSignUp'),
  recovery: document.querySelector('#emailRecovery'),
  resend: document.querySelector('#emailConfirmationResend'),
  confirmationPanel: document.querySelector('#emailConfirmationPanel'),
  pendingConfirmationEmail: document.querySelector('#pendingConfirmationEmail'),
  resendStatus: document.querySelector('#emailConfirmationResendStatus'),
  signOut: document.querySelector('#cloudSignOut'),
  captcha: document.querySelector('#authCaptcha'),
  mergeDialog: document.querySelector('#accountMergeDialog'),
  mergeSummary: document.querySelector('#accountMergeSummary'),
  mergeSections: document.querySelector('#accountMergeSections'),
  mergeConfirm: document.querySelector('#confirmAccountMerge'),
  mergeCancel: document.querySelector('#cancelAccountMerge'),
};

let client = null;
let pendingMerge = null;
let confirmingMerge = false;
let captchaWidgetId = null;
let captchaWaiter = null;
let turnstileLoader = null;
let resendTimer = null;
let busy = false;
let currentSession = null;

function setStatus(message, tone = 'neutral') {
  if (!elements.status) return;
  elements.status.textContent = message;
  elements.status.dataset.tone = tone;
}

function setResendStatus(message, tone = 'neutral') {
  if (!elements.resendStatus) return;
  elements.resendStatus.textContent = message;
  elements.resendStatus.dataset.tone = tone;
}

function registrationState() {
  return registrationReadiness(
    elements.email?.value,
    elements.password?.value,
    elements.passwordConfirmation?.value,
  );
}

function storedPendingEmail() {
  return normalizeEmail(localStorage.getItem(AUTH_PENDING_CONFIRMATION_STORAGE_KEY));
}

function setPendingConfirmation(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return;
  localStorage.setItem(AUTH_PENDING_CONFIRMATION_STORAGE_KEY, normalized);
  if (elements.email && !normalizeEmail(elements.email.value)) elements.email.value = normalized;
}

function clearPendingConfirmation() {
  localStorage.removeItem(AUTH_PENDING_CONFIRMATION_STORAGE_KEY);
  localStorage.removeItem(AUTH_RESEND_AVAILABLE_AT_STORAGE_KEY);
}

function resendAvailableAt() {
  return Number(localStorage.getItem(AUTH_RESEND_AVAILABLE_AT_STORAGE_KEY) || 0);
}

function startResendCooldown() {
  const availableAt = Date.now() + AUTH_RESEND_COOLDOWN_SECONDS * 1000;
  localStorage.setItem(AUTH_RESEND_AVAILABLE_AT_STORAGE_KEY, String(availableAt));
}

function refreshResendTimer(delaySeconds) {
  if (delaySeconds > 0 && resendTimer === null) {
    resendTimer = window.setInterval(refreshControls, 1000);
    return;
  }
  if (delaySeconds === 0 && resendTimer !== null) {
    window.clearInterval(resendTimer);
    resendTimer = null;
  }
}

function renderConfirmationPanel() {
  if (!elements.confirmationPanel || !elements.resend) return;
  const summary = sessionSummary(currentSession);
  const confirmedEmailSession = summary?.provider === 'email' && summary.emailVerified;
  elements.confirmationPanel.hidden = Boolean(confirmedEmailSession);
  if (confirmedEmailSession) {
    clearPendingConfirmation();
    refreshResendTimer(0);
    return;
  }

  const pendingEmail = storedPendingEmail();
  const email = pendingEmail || normalizeEmail(elements.email?.value);
  if (elements.pendingConfirmationEmail) {
    elements.pendingConfirmationEmail.hidden = !pendingEmail;
    elements.pendingConfirmationEmail.textContent = pendingEmail ? `Activación pendiente para ${pendingEmail}` : '';
  }

  const delaySeconds = confirmationResendDelaySeconds(resendAvailableAt());
  elements.resend.disabled = busy || !config.available || !email || delaySeconds > 0;
  if (delaySeconds > 0) {
    setResendStatus(`Podrás solicitar otro enlace en ${delaySeconds} s.`, 'warning');
  } else if (email) {
    setResendStatus('El nuevo enlace sustituirá al anterior y será válido durante 1 hora.');
  } else {
    setResendStatus('Escribe un email válido para poder reenviar la activación.');
  }
  refreshResendTimer(delaySeconds);
}

function refreshControls() {
  const email = normalizeEmail(elements.email?.value);
  const password = String(elements.password?.value ?? '');
  const registration = registrationState();
  const unavailable = !config.available;
  if (elements.google) elements.google.disabled = busy || unavailable;
  if (elements.facebook) elements.facebook.disabled = busy || unavailable;
  if (elements.signIn) elements.signIn.disabled = busy || unavailable || !email || !password;
  if (elements.signUp) elements.signUp.disabled = busy || unavailable || !registration.ready;
  if (elements.recovery) elements.recovery.disabled = busy || unavailable || !email;
  if (elements.signOut) elements.signOut.disabled = busy || unavailable;
  if (elements.panel) elements.panel.dataset.busy = String(busy);
  renderConfirmationPanel();
}

function setBusy(value) {
  busy = value;
  refreshControls();
}

function renderSession(session) {
  currentSession = session;
  const summary = sessionSummary(session);
  if (!elements.identity || !elements.signOut) return;
  elements.identity.hidden = !summary;
  elements.signOut.hidden = !summary;
  if (!summary) {
    elements.identity.textContent = '';
    refreshControls();
    return;
  }
  const provider = summary.provider === 'google' ? 'Google' : summary.provider === 'facebook' ? 'Facebook' : 'email';
  elements.identity.textContent = `${summary.email || 'Cuenta verificada'} · ${provider}`;
  if (summary.provider === 'email' && summary.emailVerified) clearPendingConfirmation();
  refreshControls();
}

function authHeaders(session) {
  const headers = {
    apikey: config.publishableKey,
    authorization: `Bearer ${session.access_token}`,
    'content-type': 'application/json',
    'x-device-id': deviceId,
  };
  const accountToken = window.Minuto106Access?.getAccountToken(false) || '';
  if (accountToken) headers['x-account-token'] = accountToken;
  return headers;
}

async function accountAuthRequest(action, body = {}) {
  const session = await client.currentSession();
  if (!session) throw new Error('Inicia sesión para continuar.');
  const response = await fetch(config.accountAuthApiUrl, {
    method: 'POST',
    headers: authHeaders(session),
    body: JSON.stringify({ action, ...body }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(String(payload.error || 'No se pudo vincular la cuenta.'));
    error.code = String(payload.code || 'account_auth_error');
    error.payload = payload;
    throw error;
  }
  return payload;
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
  elements.mergeSections.replaceChildren();
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
    elements.mergeSections.append(group);
  }
  elements.mergeSummary.textContent = `${normalized.totalLosses} ${normalized.totalLosses === 1 ? 'consecuencia competitiva' : 'consecuencias competitivas'} antes de unificar las cuentas.`;
}

function showMerge(payload) {
  pendingMerge = {
    proposalId: payload.proposalId,
    fingerprint: payload.fingerprint,
  };
  renderMergeImpact(payload.impact);
  elements.mergeDialog.showModal();
  elements.mergeConfirm.focus();
}

async function cancelPendingMerge() {
  if (!pendingMerge || confirmingMerge) return;
  const proposal = pendingMerge;
  pendingMerge = null;
  await accountAuthRequest('cancel-merge', { proposalId: proposal.proposalId }).catch(() => {});
}

async function synchronizeAccount() {
  const session = await client.currentSession();
  renderSession(session);
  if (!session) return null;
  setStatus('Sincronizando tu progreso con la cuenta…');
  const result = await accountAuthRequest('sync-account');
  if (result.accountToken) window.Minuto106Access.setAccountToken(result.accountToken);
  if (result.mergeRequired) {
    showMerge(result);
    setStatus('Revisa las consecuencias antes de vincular las cuentas.', 'warning');
    return result;
  }
  document.dispatchEvent(new CustomEvent('minuto106:cloud-account-synced'));
  setStatus(authRewardMessage(result.authReward || result.verificationReward), 'success');
  return result;
}

function loadTurnstile() {
  if (!config.turnstileSiteKey || window.turnstile?.render) return Promise.resolve();
  if (turnstileLoader) return turnstileLoader;

  turnstileLoader = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-minuto106-turnstile]');
    if (existing) {
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', () => reject(new Error('No se pudo cargar la verificación anti-bots.')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    script.dataset.minuto106Turnstile = 'true';
    script.addEventListener('load', resolve, { once: true });
    script.addEventListener('error', () => reject(new Error('No se pudo cargar la verificación anti-bots.')), { once: true });
    document.head.append(script);
  }).catch((error) => {
    turnstileLoader = null;
    throw error;
  });
  return turnstileLoader;
}

async function waitForTurnstile() {
  if (!config.turnstileSiteKey) return '';
  await loadTurnstile();
  if (captchaWaiter) return captchaWaiter;
  captchaWaiter = new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const poll = () => {
      if (window.turnstile?.render) {
        captchaWidgetId = window.turnstile.render(elements.captcha, {
          sitekey: config.turnstileSiteKey,
          theme: 'dark',
          callback: resolve,
          'error-callback': () => reject(new Error('No se pudo completar la verificación anti-bots.')),
          'expired-callback': () => reject(new Error('La verificación anti-bots ha caducado.')),
        });
        return;
      }
      if (Date.now() - startedAt > 10_000) {
        reject(new Error('No se pudo cargar la verificación anti-bots.'));
        return;
      }
      setTimeout(poll, 100);
    };
    poll();
  }).finally(() => {
    captchaWaiter = null;
  });
  return captchaWaiter;
}

function resetCaptcha() {
  if (captchaWidgetId !== null && window.turnstile?.remove) {
    window.turnstile.remove(captchaWidgetId);
  }
  captchaWidgetId = null;
  if (elements.captcha) elements.captcha.replaceChildren();
}

async function captchaToken() {
  if (!config.turnstileSiteKey) return '';
  if (elements.captcha) elements.captcha.hidden = false;
  try {
    return await waitForTurnstile();
  } finally {
    if (elements.captcha) elements.captcha.hidden = true;
  }
}

async function runEmailOperation(operation) {
  const email = normalizeEmail(elements.email.value);
  if (!email) throw new Error('Introduce un email válido.');

  if (operation === 'recovery' || operation === 'resend') {
    const token = await captchaToken();
    try {
      if (operation === 'recovery') {
        await client.requestPasswordRecovery(email, { captchaToken: token });
        setStatus(neutralAuthMessage('recovery'), 'success');
        return;
      }
      if (confirmationResendDelaySeconds(resendAvailableAt()) > 0) {
        throw new Error('Espera antes de solicitar otro enlace de activación.');
      }
      await client.resendSignupConfirmation(email, { captchaToken: token });
      setPendingConfirmation(email);
      startResendCooldown();
      setStatus(neutralAuthMessage('resend'), 'success');
      setResendStatus('Enlace solicitado. Revisa también la carpeta de spam.', 'success');
      return;
    } finally {
      resetCaptcha();
      refreshControls();
    }
  }

  const password = elements.password.value;
  if (operation === 'signup') {
    const readiness = registrationState();
    if (readiness.problems.length) throw new Error(readiness.problems.join(' '));
    if (readiness.confirmationProblem) throw new Error(readiness.confirmationProblem);
  } else if (!password) {
    throw new Error('Introduce tu contraseña.');
  }

  const token = await captchaToken();
  try {
    if (operation === 'signup') {
      await client.signUp(email, password, { captchaToken: token });
      setPendingConfirmation(email);
      startResendCooldown();
      setStatus(neutralAuthMessage('signup'), 'success');
      refreshControls();
      return;
    }
    const session = await client.signInWithPassword(email, password, { captchaToken: token });
    renderSession(session);
    await synchronizeAccount();
  } finally {
    resetCaptcha();
  }
}

async function handle(operation, action) {
  setBusy(true);
  try {
    await action();
  } catch (error) {
    const code = String(error.code || error.message || '').toLowerCase();
    if (operation === 'signin' && code.includes('email not confirmed')) {
      setPendingConfirmation(elements.email?.value);
    }
    const message = ['signup', 'recovery', 'resend'].includes(operation)
      ? neutralAuthMessage(operation, error.code || error.message)
      : error.message || neutralAuthMessage(operation, error.code);
    setStatus(message, 'error');
  } finally {
    setBusy(false);
  }
}

function refreshPasswordFeedback() {
  if (elements.passwordRequirements) {
    const fragment = document.createDocumentFragment();
    for (const requirement of passwordRequirements(elements.password?.value)) {
      const item = document.createElement('li');
      item.dataset.met = String(requirement.met);
      item.dataset.requirement = requirement.code;
      item.textContent = requirement.label;
      fragment.append(item);
    }
    elements.passwordRequirements.replaceChildren(fragment);
  }

  if (elements.passwordMatch) {
    const confirmationValue = elements.passwordConfirmation?.value ?? '';
    if (!confirmationValue) {
      elements.passwordMatch.textContent = 'Repite la contraseña para poder crear la cuenta.';
      elements.passwordMatch.dataset.valid = 'false';
    } else {
      const problem = passwordConfirmationProblem(elements.password?.value, confirmationValue);
      elements.passwordMatch.textContent = problem || 'Las contraseñas coinciden.';
      elements.passwordMatch.dataset.valid = String(!problem);
    }
  }
  refreshControls();
}

function unavailableMessage() {
  const local = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  return local
    ? 'Supabase local no está listo. Ejecuta pnpm supabase:start y vuelve a cargar; el servidor de desarrollo inyectará automáticamente la URL y la clave anónima local.'
    : 'La autenticación no está configurada en esta publicación. Comprueba SUPABASE_PUBLISHABLE_KEY en el workflow de Pages.';
}

async function initialize() {
  refreshPasswordFeedback();
  if (!config.available) {
    setStatus(unavailableMessage(), 'warning');
    refreshControls();
    return;
  }
  client = new SupabaseAuthClient(config);
  const session = await client.exchangeCallback();
  renderSession(session);
  if (session) await synchronizeAccount();
  else setStatus('Vincula Google, Facebook o email para recuperar tu progreso sin depender únicamente de la clave privada. Puedes asociar ambos proveedores sociales a la misma cuenta.');
  refreshControls();
}

elements.google?.addEventListener('click', () => handle('oauth', () => client.signInWithOAuth('google')));
elements.facebook?.addEventListener('click', () => handle('oauth', () => client.signInWithOAuth('facebook')));
elements.signIn?.addEventListener('click', () => handle('signin', () => runEmailOperation('signin')));
elements.signUp?.addEventListener('click', () => handle('signup', () => runEmailOperation('signup')));
elements.recovery?.addEventListener('click', () => handle('recovery', () => runEmailOperation('recovery')));
elements.resend?.addEventListener('click', () => handle('resend', () => runEmailOperation('resend')));
elements.email?.addEventListener('input', refreshControls);
elements.password?.addEventListener('input', refreshPasswordFeedback);
elements.passwordConfirmation?.addEventListener('input', refreshPasswordFeedback);
elements.signOut?.addEventListener('click', () => handle('signout', async () => {
  await client.signOut();
  renderSession(null);
  setStatus('Sesión en la nube cerrada. La clave privada de este dispositivo sigue activa.', 'success');
}));
elements.mergeConfirm?.addEventListener('click', () => handle('merge', async () => {
  if (!pendingMerge) return;
  confirmingMerge = true;
  try {
    const proposal = pendingMerge;
    const result = await accountAuthRequest('confirm-merge', proposal);
    pendingMerge = null;
    elements.mergeDialog.close();
    document.dispatchEvent(new CustomEvent('minuto106:cloud-account-synced'));
    const corrections = normalizeMergeImpact(result.impact).totalLosses;
    const rewardMessage = authRewardMessage(result.authReward || result.verificationReward);
    setStatus(`Cuentas vinculadas. Se aplicaron ${corrections} correcciones competitivas. ${rewardMessage}`, 'success');
  } finally {
    confirmingMerge = false;
  }
}));
elements.mergeCancel?.addEventListener('click', () => {
  elements.mergeDialog.close();
});
elements.mergeDialog?.addEventListener('close', () => {
  cancelPendingMerge().catch(() => {});
});

initialize().catch((error) => {
  setStatus(error.message || 'No se pudo iniciar la autenticación.', 'error');
  refreshControls();
});
