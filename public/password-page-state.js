import {
  passwordConfirmationProblem,
  passwordProblems,
} from './auth-account-state.js';

export const PASSWORD_PAGE_MODES = Object.freeze({
  change: 'change',
  recovery: 'recovery',
  unavailable: 'unavailable',
});

function passwordUrl(urlValue) {
  return new URL(String(urlValue ?? ''), 'http://localhost');
}

export function hasPasswordCallback(urlValue) {
  try {
    const url = passwordUrl(urlValue);
    const hash = new URLSearchParams(url.hash.replace(/^#/u, ''));
    return Boolean(
      url.searchParams.get('code')
      || url.searchParams.get('token_hash')
      || url.searchParams.get('type') === 'recovery'
      || hash.get('access_token')
      || hash.get('type') === 'recovery',
    );
  } catch {
    return false;
  }
}

export function isPasswordChangeRequest(urlValue) {
  try {
    return passwordUrl(urlValue).searchParams.get('mode') === PASSWORD_PAGE_MODES.change;
  } catch {
    return false;
  }
}

export function resolvePasswordPageMode({
  hadSessionBeforeExchange = false,
  callbackPresent = false,
  changeRequested = false,
  session = null,
} = {}) {
  if (!session) return PASSWORD_PAGE_MODES.unavailable;
  if (changeRequested && hadSessionBeforeExchange && !callbackPresent) return PASSWORD_PAGE_MODES.change;
  return PASSWORD_PAGE_MODES.recovery;
}

export function passwordPageContent(modeValue) {
  const mode = Object.values(PASSWORD_PAGE_MODES).includes(modeValue)
    ? modeValue
    : PASSWORD_PAGE_MODES.unavailable;
  if (mode === PASSWORD_PAGE_MODES.change) {
    return Object.freeze({
      eyebrow: 'SEGURIDAD DE LA CUENTA',
      title: 'Cambiar contraseña',
      lead: 'Confirma tu contraseña actual y elige una nueva que no uses en otros servicios.',
      currentPasswordVisible: true,
      submitLabel: 'Cambiar contraseña',
      readyMessage: 'La nueva contraseña cumple todos los requisitos.',
      successMessage: 'Contraseña actualizada. Tu sesión continúa activa.',
    });
  }
  if (mode === PASSWORD_PAGE_MODES.recovery) {
    return Object.freeze({
      eyebrow: 'RECUPERACIÓN SEGURA',
      title: 'Restablecer contraseña',
      lead: 'El enlace solo puede utilizarse durante un tiempo limitado. Elige una contraseña que no uses en otros servicios.',
      currentPasswordVisible: false,
      submitLabel: 'Guardar nueva contraseña',
      readyMessage: 'La nueva contraseña cumple todos los requisitos.',
      successMessage: 'Contraseña actualizada. Tu sesión ya está activa.',
    });
  }
  return Object.freeze({
    eyebrow: 'RECUPERACIÓN SEGURA',
    title: 'Contraseña no disponible',
    lead: 'Abre un enlace de recuperación válido o inicia sesión para cambiar la contraseña.',
    currentPasswordVisible: false,
    submitLabel: 'Guardar nueva contraseña',
    readyMessage: '',
    successMessage: '',
  });
}

export function passwordUpdateProblem({ mode, currentPassword, password, confirmation } = {}) {
  const problems = passwordProblems(password);
  if (problems.length > 0) return problems.join(' ');
  const confirmationProblem = passwordConfirmationProblem(password, confirmation);
  if (confirmationProblem) return confirmationProblem;
  if (mode === PASSWORD_PAGE_MODES.change && !String(currentPassword ?? '')) {
    return 'Introduce tu contraseña actual.';
  }
  return '';
}
