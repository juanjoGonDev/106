import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearPendingConfirmation,
  pendingConfirmationEmail,
  pendingConfirmationSnapshot,
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

test('stores a normalized email and one-minute resend boundary', () => {
  const store = storage();
  const result = storePendingConfirmation(store, ' USER@Example.com ', 1_000);
  assert.deepEqual({ ...result }, { email: 'user@example.com', availableAt: 61_000 });
  assert.equal(pendingConfirmationSnapshot(store, 1_000).resendDelaySeconds, 60);
  assert.equal(pendingConfirmationSnapshot(store, 61_000).resendDelaySeconds, 0);
  assert.throws(() => storePendingConfirmation(store, 'invalid', 1_000), /email válido/);
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
