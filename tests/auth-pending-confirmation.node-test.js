import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearPendingConfirmation,
  pendingConfirmationEmail,
  pendingConfirmationSnapshot,
  pendingConfirmationView,
  resendPendingConfirmation,
  storePendingConfirmation,
} from '../public/auth-pending-confirmation.js';

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    values,
  };
}

test('reads normalized pending email and safe empty snapshots', () => {
  assert.equal(pendingConfirmationEmail(null), '');
  const store = storage({ 'minuto106:pending-email-confirmation-v1': ' USER@Example.com ' });
  assert.equal(pendingConfirmationEmail(store), 'user@example.com');
  assert.deepEqual({ ...pendingConfirmationSnapshot(null, 1_000) }, {
    email: '', availableAt: 0, resendDelaySeconds: 0,
  });
  const invalid = storage({ 'minuto106:email-resend-available-at-v1': 'invalid' });
  assert.equal(pendingConfirmationSnapshot(invalid, 1_000).availableAt, 0);
});

test('derives reusable confirmation and resend presentation states', () => {
  assert.deepEqual({ ...pendingConfirmationView(null) }, {
    email: '',
    emailText: '',
    resendAvailable: false,
    resendDelaySeconds: 0,
    resendStatus: 'No se encontró un email pendiente.',
    resendTone: 'neutral',
  });
  assert.deepEqual({ ...pendingConfirmationView({ email: ' USER@Example.com ', resendDelaySeconds: 4.2 }) }, {
    email: 'user@example.com',
    emailText: 'Activación pendiente para user@example.com',
    resendAvailable: false,
    resendDelaySeconds: 5,
    resendStatus: 'Podrás solicitar otro código en 5 s.',
    resendTone: 'warning',
  });
  assert.deepEqual({ ...pendingConfirmationView({ email: 'user@example.com', resendDelaySeconds: -1 }) }, {
    email: 'user@example.com',
    emailText: 'Activación pendiente para user@example.com',
    resendAvailable: true,
    resendDelaySeconds: 0,
    resendStatus: 'El nuevo código y enlace serán válidos durante 1 hora.',
    resendTone: 'neutral',
  });
});

test('stores a normalized email and one-minute resend boundary', () => {
  const store = storage();
  const result = storePendingConfirmation(store, ' USER@Example.com ', 1_000);
  assert.deepEqual({ ...result }, { email: 'user@example.com', availableAt: 61_000 });
  assert.equal(pendingConfirmationSnapshot(store, 1_000).resendDelaySeconds, 60);
  assert.equal(pendingConfirmationSnapshot(store, 61_000).resendDelaySeconds, 0);
  assert.throws(() => storePendingConfirmation(store, 'invalid', 1_000), /email válido/);
});

test('resends through the shared client and captcha boundary exactly once', async () => {
  const store = storage({ 'minuto106:pending-email-confirmation-v1': 'user@example.com' });
  const calls = [];
  const result = await resendPendingConfirmation({
    client: {
      async resendSignupConfirmation(email, options) { calls.push({ email, options }); },
    },
    captcha: { async token() { return 'captcha-token'; } },
    storage: store,
    now: 1_000,
  });
  assert.deepEqual(calls, [{ email: 'user@example.com', options: { captchaToken: 'captcha-token' } }]);
  assert.equal(result.email, 'user@example.com');
  assert.equal(result.resendDelaySeconds, 60);
});

test('rejects absent and cooling-down confirmations before external effects', async () => {
  let effects = 0;
  const dependencies = {
    client: { async resendSignupConfirmation() { effects += 1; } },
    captcha: { async token() { effects += 1; return 'token'; } },
    now: 1_000,
  };
  await assert.rejects(resendPendingConfirmation({ ...dependencies, storage: storage() }), /email pendiente/);
  const cooling = storage({
    'minuto106:pending-email-confirmation-v1': 'user@example.com',
    'minuto106:email-resend-available-at-v1': '61000',
  });
  await assert.rejects(resendPendingConfirmation({ ...dependencies, storage: cooling }), /Espera/);
  assert.equal(effects, 0);
});

test('clears both pending activation values safely', () => {
  const store = storage({
    'minuto106:pending-email-confirmation-v1': 'user@example.com',
    'minuto106:email-resend-available-at-v1': '61000',
  });
  clearPendingConfirmation(store);
  assert.equal(store.values.size, 0);
  clearPendingConfirmation(null);
});
