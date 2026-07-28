import assert from 'node:assert/strict';
import test from 'node:test';

import { CloudAccountService } from '../public/cloud-account-service.js';

const config = {
  publishableKey: 'sb_publishable_test',
  accountAuthApiUrl: 'https://project.supabase.co/functions/v1/account-auth',
};
const session = { access_token: 'access-token' };

function storage(deviceId = 'browser-device-106') {
  const values = new Map([['minuto106:device-id', deviceId]]);
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
  };
}

test('uses browser fetch, storage, crypto and access defaults', async () => {
  const priorWindow = globalThis.window;
  const priorCrypto = globalThis.crypto;
  const calls = [];
  const tokens = [];
  try {
    globalThis.window = {
      localStorage: storage(),
      Minuto106Access: {
        getAccountToken: () => 'b'.repeat(64),
        setAccountToken: (value) => tokens.push(value),
      },
      async fetch(url, options) {
        calls.push({ url, options });
        return {
          ok: true,
          async json() { return { accountToken: 'c'.repeat(64) }; },
        };
      },
    };
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { randomUUID: () => '11111111-1111-4111-8111-111111111111' },
    });

    const service = new CloudAccountService(config, { currentSession: async () => session });
    assert.equal((await service.synchronize()).accountToken, 'c'.repeat(64));
    assert.deepEqual(tokens, ['c'.repeat(64)]);
    assert.equal(calls[0].url, config.accountAuthApiUrl);
    assert.equal(calls[0].options.headers['x-account-token'], 'b'.repeat(64));
  } finally {
    globalThis.window = priorWindow;
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: priorCrypto });
  }
});

test('allows an explicit null access adapter even when a token is returned', async () => {
  const service = new CloudAccountService(config, { currentSession: async () => session }, {
    storage: storage('explicit-null-device'),
    crypto: { randomUUID: () => 'unused' },
    access: null,
    fetch: async () => ({
      ok: true,
      async json() { return { accountToken: 'd'.repeat(64) }; },
    }),
  });
  assert.equal((await service.synchronize()).accountToken, 'd'.repeat(64));
}));