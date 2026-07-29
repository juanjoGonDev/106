import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PASSWORD_PAGE_MODES,
  hasPasswordCallback,
  isPasswordChangeRequest,
  passwordPageContent,
  passwordUpdateProblem,
  resolvePasswordPageMode,
} from '../public/password-page-state.js';

const invalidUrlValue = {
  [Symbol.toPrimitive]() {
    throw new Error('invalid URL value');
  },
};

test('detects recovery callbacks from every supported URL shape', () => {
  assert.equal(hasPasswordCallback('https://example.com/restablecer-clave.html?code=abc'), true);
  assert.equal(hasPasswordCallback('https://example.com/restablecer-clave.html?token_hash=abc'), true);
  assert.equal(hasPasswordCallback('https://example.com/restablecer-clave.html?type=recovery'), true);
  assert.equal(hasPasswordCallback('https://example.com/restablecer-clave.html#access_token=abc'), true);
  assert.equal(hasPasswordCallback('https://example.com/restablecer-clave.html#type=recovery'), true);
  assert.equal(hasPasswordCallback('https://example.com/restablecer-clave.html?type=email'), false);
  assert.equal(hasPasswordCallback(null), false);
  assert.equal(hasPasswordCallback(invalidUrlValue), false);
});

test('detects only explicit authenticated password change requests', () => {
  assert.equal(isPasswordChangeRequest('https://example.com/restablecer-clave.html?mode=change'), true);
  assert.equal(isPasswordChangeRequest('https://example.com/restablecer-clave.html?mode=recovery'), false);
  assert.equal(isPasswordChangeRequest('https://example.com/restablecer-clave.html'), false);
  assert.equal(isPasswordChangeRequest(null), false);
  assert.equal(isPasswordChangeRequest(invalidUrlValue), false);
});

test('distinguishes explicit authenticated change, recovery and unavailable modes', () => {
  const session = { user: { id: 'user' } };
  assert.equal(resolvePasswordPageMode({
    hadSessionBeforeExchange: true,
    changeRequested: true,
    session,
  }), PASSWORD_PAGE_MODES.change);
  assert.equal(resolvePasswordPageMode({
    hadSessionBeforeExchange: true,
    callbackPresent: true,
    changeRequested: true,
    session,
  }), PASSWORD_PAGE_MODES.recovery);
  assert.equal(resolvePasswordPageMode({ hadSessionBeforeExchange: true, session }), PASSWORD_PAGE_MODES.recovery);
  assert.equal(resolvePasswordPageMode({ hadSessionBeforeExchange: false, session }), PASSWORD_PAGE_MODES.recovery);
  assert.equal(resolvePasswordPageMode({ changeRequested: true }), PASSWORD_PAGE_MODES.unavailable);
  assert.equal(resolvePasswordPageMode(), PASSWORD_PAGE_MODES.unavailable);
});

test('provides complete mode-specific copy and safe fallback content', () => {
  assert.deepEqual(passwordPageContent(PASSWORD_PAGE_MODES.change), {
    eyebrow: 'SEGURIDAD DE LA CUENTA',
    title: 'Cambiar contraseña',
    lead: 'Confirma tu contraseña actual y elige una nueva que no uses en otros servicios.',
    currentPasswordVisible: true,
    submitLabel: 'Cambiar contraseña',
    readyMessage: 'La nueva contraseña cumple todos los requisitos.',
    successMessage: 'Contraseña actualizada. Tu sesión continúa activa.',
  });
  assert.equal(passwordPageContent(PASSWORD_PAGE_MODES.recovery).currentPasswordVisible, false);
  assert.equal(passwordPageContent(PASSWORD_PAGE_MODES.recovery).successMessage, 'Contraseña actualizada. Tu sesión ya está activa.');
  assert.equal(passwordPageContent('invalid').title, 'Contraseña no disponible');
  assert.equal(passwordPageContent(PASSWORD_PAGE_MODES.unavailable).successMessage, '');
});

test('validates shared password policy, exact confirmation and current password only in change mode', () => {
  assert.match(passwordUpdateProblem({
    mode: PASSWORD_PAGE_MODES.recovery,
    password: 'short',
    confirmation: 'short',
  }), /al menos 10 caracteres/u);
  assert.equal(passwordUpdateProblem({
    mode: PASSWORD_PAGE_MODES.recovery,
    password: 'Secure123!',
    confirmation: '',
  }), 'Repite la contraseña para confirmar que está bien escrita.');
  assert.equal(passwordUpdateProblem({
    mode: PASSWORD_PAGE_MODES.recovery,
    password: 'Secure123!',
    confirmation: 'Different1!',
  }), 'Las contraseñas no coinciden.');
  assert.equal(passwordUpdateProblem({
    mode: PASSWORD_PAGE_MODES.change,
    password: 'Secure123!',
    confirmation: 'Secure123!',
    currentPassword: '',
  }), 'Introduce tu contraseña actual.');
  assert.equal(passwordUpdateProblem({
    mode: PASSWORD_PAGE_MODES.change,
    password: 'Secure123!',
    confirmation: 'Secure123!',
    currentPassword: null,
  }), 'Introduce tu contraseña actual.');
  assert.equal(passwordUpdateProblem({
    mode: PASSWORD_PAGE_MODES.change,
    password: 'Secure123!',
    confirmation: 'Secure123!',
    currentPassword: 'Current123!',
  }), '');
  assert.equal(passwordUpdateProblem({
    mode: PASSWORD_PAGE_MODES.recovery,
    password: 'Secure123!',
    confirmation: 'Secure123!',
  }), '');
});
