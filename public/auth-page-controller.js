import {
  authRewardMessage,
  neutralAuthMessage,
  normalizeAuthConfig,
  normalizeEmail,
  passwordConfirmationProblem,
  passwordRequirements,
  registrationReadiness,
} from './auth-account-state.js';
import { AuthCaptcha } from './auth-captcha.js';
import { browserAuthExperience, redirectToAuthRoute } from './auth-browser-context.js';
import {
  AUTH_ROUTES,
  authRouteUrl,
  providerAction,
} from './auth-experience-state.js';
import {
  clearPendingConfirmation,
  pendingConfirmationSnapshot,
  pendingConfirmationView,
  resendPendingConfirmation,
  storePendingConfirmation,
} from './auth-pending-confirmation.js';
import { CloudAccountService } from './cloud-account-service.js';
import { SupabaseAuthClient } from './supabase-auth-client.js';

const config = normalizeAuthConfig(window.__MINUTO106_CONFIG__);
const pageMode = String(document.body.dataset.authPage || '');
const elements = {
  shell: document.querySelector('[data-auth-shell]'),
  status: document.querySelector('#authStatus'),
  email: document.querySelector('#authEmail'),
  password: document.querySelector('#authPassword'),
  confirmation: document.querySelector('#authPasswordConfirmation'),
  requirements: document.querySelector('#authPasswordRequirements'),
  match: document.querySelector('#authPasswordMatch'),
  submit: document.querySelector('#authSubmit'),
  recovery: document.querySelector('#authRecovery'),
  google: document.querySelector('#googleSignIn'),
  captcha: document.querySelector('#authCaptcha'),
  otp: document.querySelector('#authOtp'),
  verify: document.querySelector('#verifyEmailCode'),
  resend: document.querySelector('#emailConfirmationResend'),
  resendStatus: document.querySelector('#emailConfirmationResendStatus'),
  pendingEmail: document.querySelector('#pendingConfirmationEmail'),
  success: document.querySelector('#verificationSuccess'),
  successMessage: document.querySelector('#verificationSuccessMessage'),
};

let client = null;
let service = null;
let captcha = null;
let busy = false;
let resendTimer = null;

function setStatus(message, tone = 'neutral') {
  if (!elements.status) return;
  elements.status.textContent = message;
  elements.status.dataset.tone = tone;
}

function setBusy(value) {
  busy = value;
  if (elements.shell) elements.shell.dataset.busy = String(value);
  refreshControls();
}

function pendingState() {
  return pendingConfirmationSnapshot(localStorage);
}

function refreshPasswordFeedback() {
  if (elements.requirements) {
    const fragment = document.createDocumentFragment();
    for (const requirement of passwordRequirements(elements.password?.value)) {
      const item = document.createElement('li');
      item.dataset.met = String(requirement.met);
      item.dataset.requirement = requirement.code;
      item.textContent = requirement.label;
      fragment.append(item);
    }
    elements.requirements.replaceChildren(fragment);
  }
  if (!elements.match) return;
  const confirmation = elements.confirmation?.value || '';
  const problem = passwordConfirmationProblem(elements.password?.value, confirmation);
  elements.match.textContent = confirmation ? (problem || 'Las contraseñas coinciden.') : problem;
  elements.match.dataset.valid = String(Boolean(confirmation) && !problem);
}

function manageResendTimer(delaySeconds) {
  if (delaySeconds > 0 && resendTimer === null) {
    resendTimer = window.setInterval(refreshControls, 1000);
    return;
  }
  if (delaySeconds === 0 && resendTimer !== null) {
    window.clearInterval(resendTimer);
    resendTimer = null;
  }
}

function refreshResend() {
  if (!elements.resend) return;
  const view = pendingConfirmationView(pendingState());
  elements.resend.disabled = busy || !config.available || !view.resendAvailable;
  if (elements.pendingEmail) {
    elements.pendingEmail.textContent = view.emailText;
    elements.pendingEmail.hidden = !view.email;
  }
  if (elements.resendStatus) {
    elements.resendStatus.textContent = view.resendStatus;
    elements.resendStatus.dataset.tone = view.resendTone;
  }
  manageResendTimer(view.resendDelaySeconds);
}

function refreshControls() {
  const unavailable = !config.available;
  if (elements.google) elements.google.disabled = busy || unavailable;

  if (pageMode === 'login') {
    const email = normalizeEmail(elements.email?.value);
    const password = String(elements.password?.value || '');
    if (elements.submit) elements.submit.disabled = busy || unavailable || !email || !password;
    if (elements.recovery) elements.recovery.disabled = busy || unavailable || !email;
  }

  if (pageMode === 'register') {
    const readiness = registrationReadiness(
      elements.email?.value,
      elements.password?.value,
      elements.confirmation?.value,
    );
    if (elements.submit) elements.submit.disabled = busy || unavailable || !readiness.ready;
  }

  if (pageMode === 'verify') {
    const code = String(elements.otp?.value || '').replace(/\D/gu, '');
    if (elements.verify) elements.verify.disabled = busy || unavailable || code.length !== 6 || !pendingState().email;
    refreshResend();
  }
}

function renderProviderButton(mode, identity = null) {
  if (!elements.google) return;
  const action = providerAction('google', mode, identity);
  elements.google.textContent = action.label;
  elements.google.disabled = action.disabled || busy || !config.available;
}

async function withOperation(operation, action) {
  setBusy(true);
  try {
    await action();
  } catch (error) {
    const message = ['signup', 'recovery', 'resend'].includes(operation)
      ? neutralAuthMessage(operation, error.code || error.message)
      : error.message || neutralAuthMessage(operation, error.code);
    setStatus(message, 'error');
  } finally {
    captcha?.reset();
    setBusy(false);
  }
}

async function startOAuth() {
  await client.signInWithOAuth('google', {
    returnPage: AUTH_ROUTES.account,
    redirectTo: authRouteUrl(config.publicSiteUrl, AUTH_ROUTES.account),
  });
}

async function signIn() {
  const token = await captcha.token();
  await client.signInWithPassword(elements.email.value, elements.password.value, { captchaToken: token });
  location.assign(authRouteUrl(config.publicSiteUrl, AUTH_ROUTES.account));
}

async function recoverPassword() {
  const token = await captcha.token();
  await client.requestPasswordRecovery(elements.email.value, { captchaToken: token });
  setStatus(neutralAuthMessage('recovery'), 'success');
}

async function register() {
  const readiness = registrationReadiness(
    elements.email.value,
    elements.password.value,
    elements.confirmation.value,
  );
  if (!readiness.ready) {
    throw new Error([...readiness.problems, readiness.confirmationProblem].filter(Boolean).join(' '));
  }
  const token = await captcha.token();
  await client.signUp(readiness.email, elements.password.value, { captchaToken: token });
  storePendingConfirmation(localStorage, readiness.email);
  location.assign(authRouteUrl(config.publicSiteUrl, AUTH_ROUTES.verify));
}

async function synchronizeVerifiedAccount() {
  const result = await service.synchronize();
  if (result.mergeRequired) {
    return 'Email confirmado. Abre Mi cuenta para revisar la vinculación antes de aplicar los cambios competitivos.';
  }
  document.dispatchEvent(new CustomEvent('minuto106:cloud-account-synced'));
  return authRewardMessage(result.authReward || result.verificationReward);
}

async function finishVerification(session) {
  if (!session) throw new Error('No se pudo iniciar la sesión verificada.');
  clearPendingConfirmation(localStorage);
  const message = await synchronizeVerifiedAccount();
  if (elements.success) elements.success.hidden = false;
  if (elements.successMessage) elements.successMessage.textContent = message;
  setStatus(message, 'success');
  if (elements.verify) elements.verify.hidden = true;
  if (elements.resend) elements.resend.hidden = true;
}

async function verifyCode() {
  const snapshot = pendingState();
  const code = String(elements.otp.value || '').replace(/\D/gu, '');
  const session = await client.verifyEmailOtp(snapshot.email, code);
  await finishVerification(session);
}

async function verifyLinkToken(hash) {
  const session = await client.verifyTokenHash(hash);
  await finishVerification(session);
}

async function resendConfirmation() {
  await resendPendingConfirmation({ client, captcha, storage: localStorage });
  setStatus(neutralAuthMessage('resend'), 'success');
}

function bindEvents() {
  elements.google?.addEventListener('click', () => withOperation('oauth', startOAuth));
  elements.submit?.addEventListener('click', () => withOperation(pageMode === 'register' ? 'signup' : 'signin', pageMode === 'register' ? register : signIn));
  elements.recovery?.addEventListener('click', () => withOperation('recovery', recoverPassword));
  elements.verify?.addEventListener('click', () => withOperation('verify', verifyCode));
  elements.resend?.addEventListener('click', () => withOperation('resend', resendConfirmation));
  elements.email?.addEventListener('input', refreshControls);
  elements.password?.addEventListener('input', () => {
    refreshPasswordFeedback();
    refreshControls();
  });
  elements.confirmation?.addEventListener('input', () => {
    refreshPasswordFeedback();
    refreshControls();
  });
  elements.otp?.addEventListener('input', () => {
    elements.otp.value = elements.otp.value.replace(/\D/gu, '').slice(0, 6);
    refreshControls();
  });
}

async function initialize() {
  if (!config.available) {
    setStatus('La autenticación no está configurada en este entorno.', 'warning');
    refreshPasswordFeedback();
    refreshControls();
    return;
  }

  client = new SupabaseAuthClient(config);
  service = new CloudAccountService(config, client);
  captcha = new AuthCaptcha(config.turnstileSiteKey, elements.captcha);
  const experience = await browserAuthExperience({
    client,
    config: window.__MINUTO106_CONFIG__,
    access: window.Minuto106Access,
  });
  if (redirectToAuthRoute(experience, window.__MINUTO106_CONFIG__)) return;

  renderProviderButton(experience.mode, experience.identity);
  if (pageMode === 'verify') {
    const snapshot = pendingState();
    if (elements.email) elements.email.value = snapshot.email;
    const url = new URL(location.href);
    const hash = url.searchParams.get('token_hash') || '';
    if (hash) {
      url.searchParams.delete('token_hash');
      url.searchParams.delete('type');
      history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
      await withOperation('verify', () => verifyLinkToken(hash));
    } else {
      setStatus('Introduce el código de 6 dígitos o abre el enlace recibido. Al verificar ganas +1 intento diario y el logro Cuenta confirmada.');
    }
  } else if (pageMode === 'login') {
    setStatus('Accede con email o Google.');
  } else {
    setStatus('Crea tu cuenta. Después podrás confirmar el email con un código o enlace de un solo uso.');
  }
  refreshPasswordFeedback();
  refreshControls();
}

bindEvents();
window.addEventListener('pagehide', () => {
  if (resendTimer !== null) window.clearInterval(resendTimer);
});
initialize().catch((error) => {
  setStatus(error.message || 'No se pudo iniciar la autenticación.', 'error');
  refreshControls();
});
