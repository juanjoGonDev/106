import assert from 'node:assert/strict';
import test from 'node:test';

const originalDocument = globalThis.document;
const originalLocalStorage = globalThis.localStorage;

async function runBootstrap({ input, pending, caseName }) {
  globalThis.document = {
    querySelector(selector) {
      assert.equal(selector, '#authEmail');
      return input;
    },
  };
  globalThis.localStorage = {
    getItem(key) {
      assert.equal(key, 'minuto106:pending-email-confirmation-v1');
      return pending;
    },
  };
  await import(`../public/account-auth-bootstrap.js?case=${caseName}`);
}

test.after(() => {
  globalThis.document = originalDocument;
  globalThis.localStorage = originalLocalStorage;
});

test('restores a valid pending email into an empty account form', async () => {
  const input = { value: '' };
  await runBootstrap({ input, pending: ' Pending@Example.com ', caseName: 'restore' });
  assert.equal(input.value, 'pending@example.com');
});

test('preserves a valid email already entered by the user', async () => {
  const input = { value: 'current@example.com' };
  await runBootstrap({ input, pending: 'pending@example.com', caseName: 'preserve' });
  assert.equal(input.value, 'current@example.com');
});

test('ignores invalid pending data and a missing input safely', async () => {
  const input = { value: '' };
  await runBootstrap({ input, pending: 'invalid', caseName: 'invalid' });
  assert.equal(input.value, '');

  await runBootstrap({ input: null, pending: 'pending@example.com', caseName: 'missing-input' });
});
