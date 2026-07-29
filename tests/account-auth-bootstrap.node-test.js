import assert from 'node:assert/strict';
import test from 'node:test';

const originalDocument = globalThis.document;
const originalLocalStorage = globalThis.localStorage;
const bootstrappedInput = { value: '' };

globalThis.document = {
  querySelector(selector) {
    assert.equal(selector, '#authEmail');
    return bootstrappedInput;
  },
};
globalThis.localStorage = {
  getItem(key) {
    assert.equal(key, 'minuto106:pending-email-confirmation-v1');
    return ' Pending@Example.com ';
  },
};

const { restorePendingActivationEmail } = await import('../public/account-auth-bootstrap.js');

test.after(() => {
  globalThis.document = originalDocument;
  globalThis.localStorage = originalLocalStorage;
});

test('restores the pending activation email during module bootstrap', () => {
  assert.equal(bootstrappedInput.value, 'pending@example.com');
});

test('preserves a valid email already entered by the user', () => {
  const input = { value: 'current@example.com' };
  assert.equal(
    restorePendingActivationEmail(input, 'pending@example.com'),
    'current@example.com',
  );
  assert.equal(input.value, 'current@example.com');
});

test('ignores invalid pending data and a missing input safely', () => {
  const input = { value: '' };
  assert.equal(restorePendingActivationEmail(input, 'invalid'), '');
  assert.equal(input.value, '');
  assert.equal(restorePendingActivationEmail(null, 'pending@example.com'), '');
});
