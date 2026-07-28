import assert from 'node:assert/strict';
import test from 'node:test';

import { CloudAccountService, getOrCreateDeviceId } from '../public/cloud-account-service.js';

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
  };
}

function response(status, payload, jsonFailure = false) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      if (jsonFailure) throw new Error('invalid json');
      return payload;
    },
  };
}

const config = {
  publishableKey: `sb_publishable_${'a'.repeat(24)}`,
  accountAuthApiUrl: 'https://project.supabase.co/functions/v1/account-auth',
};
const session = { access_token: 'access-token' };

test('reuses valid device identifiers and replaces invalid values', () => {
  const existing = storage({ 'minuto106:device-id': 'existing-device-106' });
  assert.equal(getOrCreateDeviceId(existing, { randomUUID: () => 'new-device' }), 'existing-device-106');

  const empty = storage({ 'minuto106:device-id': 'short' });
  assert.equal(getOrCreateDeviceId(empty, { randomUUID: () => '11111111-1111-4111-8111-111111111111' }), '11111111-1111-4111-8111-111111111111');
  assert.equal(empty.getItem('minuto106:device-id'), '11111111-1111-4111-8111-111111111111');
});

test('sends authenticated account requests with optional local account token', async () => {
  const calls = [];
  const service = new CloudAccountService(config, { currentSession: async () => session }, {
    storage: storage({ 'minuto106:device-id': 'existing-device-106' }),
    crypto: { randomUUID: () => 'unused' },
    access: { getAccountToken: () => 'b'.repeat(64) },
    fetch: async (url, options) => {
      calls.push({ url, options });
      return response(200, { ok: true });
    },
  });
  assert.deepEqual(await service.request('sync-account', { x: 1 }), { ok: true });
  assert.equal(calls[0].url, config.accountAuthApiUrl);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.authorization, 'Bearer access-token');
  assert.equal(calls[0].options.headers.apikey, config.publishableKey);
  assert.equal(calls[0].options.headers['x-device-id'], 'existing-device-106');
  assert.equal(calls[0].options.headers['x-account-token'], 'b'.repeat(64));
  assert.equal(calls[0].options.body, JSON.stringify({ action: 'sync-account', x: 1 }));

  const withoutToken = new CloudAccountService(config, { currentSession: async () => session }, {
    storage: storage({ 'minuto106:device-id': 'existing-device-106' }),
    crypto: { randomUUID: () => 'unused' },
    access: null,
    fetch: async (_url, options) => {
      assert.equal('x-account-token' in options.headers, false);
      return response(200, {});
    },
  });
  await withoutToken.request('sync-account');
});

test('requires a session and preserves structured backend errors', async () => {
  const noSession = new CloudAccountService(config, { currentSession: async () => null }, {
    storage: storage(),
    crypto: { randomUUID: () => '11111111-1111-4111-8111-111111111111' },
    fetch: async () => { throw new Error('must not fetch'); },
  });
  await assert.rejects(() => noSession.request('sync-account'), /Inicia sesión/);

  const failing = new CloudAccountService(config, { currentSession: async () => session }, {
    storage: storage(),
    crypto: { randomUUID: () => '11111111-1111-4111-8111-111111111111' },
    fetch: async () => response(409, { error: 'Merge required', code: 'merge_required', detail: 1 }),
  });
  await assert.rejects(async () => {
    try {
      await failing.request('sync-account');
    } catch (error) {
      assert.equal(error.code, 'merge_required');
      assert.equal(error.payload.detail, 1);
      throw error;
    }
  }, /Merge required/);

  const invalidJson = new CloudAccountService(config, { currentSession: async () => session }, {
    storage: storage(),
    crypto: { randomUUID: () => '11111111-1111-4111-8111-111111111111' },
    fetch: async () => response(500, {}, true),
  });
  await assert.rejects(() => invalidJson.request('sync-account'), /No se pudo vincular la cuenta/);
});

test('synchronizes tokens and wraps merge operations', async () => {
  const actions = [];
  const tokens = [];
  const service = new CloudAccountService(config, { currentSession: async () => session }, {
    storage: storage(),
    crypto: { randomUUID: () => '11111111-1111-4111-8111-111111111111' },
    access: {
      getAccountToken: () => '',
      setAccountToken: (value) => tokens.push(value),
    },
    fetch: async (_url, options) => {
      const body = JSON.parse(options.body);
      actions.push(body);
      if (body.action === 'sync-account') return response(200, { accountToken: 'c'.repeat(64) });
      return response(200, { action: body.action });
    },
  });

  assert.equal((await service.synchronize()).accountToken, 'c'.repeat(64));
  assert.deepEqual(tokens, ['c'.repeat(64)]);
  assert.deepEqual(await service.confirmMerge({ proposalId: 'p1', fingerprint: 'f1' }), { action: 'confirm-merge' });
  assert.deepEqual(await service.cancelMerge('p1'), { action: 'cancel-merge' });
  assert.equal(await service.cancelMerge(''), null);
  assert.deepEqual(actions.map((entry) => entry.action), ['sync-account', 'confirm-merge', 'cancel-merge']);

  const noToken = new CloudAccountService(config, { currentSession: async () => session }, {
    storage: storage(),
    crypto: { randomUUID: () => '11111111-1111-4111-8111-111111111111' },
    access: { getAccountToken: () => '', setAccountToken: () => { throw new Error('must not set'); } },
    fetch: async () => response(200, {}),
  });
  assert.deepEqual(await noToken.synchronize(), {});
});
