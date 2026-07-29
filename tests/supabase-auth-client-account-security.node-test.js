import assert from 'node:assert/strict';
import test from 'node:test';

import { SupabaseAuthClient } from '../public/supabase-auth-client.js';
import {
  AUTH_PKCE_STORAGE_KEY,
  AUTH_RETURN_STORAGE_KEY,
  AUTH_SESSION_STORAGE_KEY,
} from '../public/auth-account-state.js';

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };
}

function response(payload, { ok = true, status = 200 } = {}) {
  return { ok, status, async json() { return payload; } };
}

function session() {
  return {
    access_token: 'access',
    refresh_token: 'refresh',
    expires_at: 2_000_000_000,
    token_type: 'bearer',
    user: { id: 'user-id', email: 'user@example.com' },
  };
}

function createClient({ storage, fetch }) {
  return new SupabaseAuthClient({
    supabaseUrl: 'https://project.supabase.co',
    publishableKey: 'sb_publishable_key',
    publicSiteUrl: 'https://example.com/106',
  }, {
    storage,
    fetch,
    location: { href: 'https://example.com/106/cuenta.html', assign() {} },
    history: { replaceState() {} },
    crypto: {
      getRandomValues(bytes) { bytes.fill(7); return bytes; },
      subtle: { async digest() { return new Uint8Array([1, 2, 3]).buffer; } },
    },
    now: () => 1_000_000,
  });
}

test('authenticated password changes send the current password without duplicating recovery behavior', async () => {
  const storage = createStorage({ [AUTH_SESSION_STORAGE_KEY]: JSON.stringify(session()) });
  const calls = [];
  const client = createClient({
    storage,
    fetch: async (url, options) => {
      calls.push({ url, options });
      return response({ id: 'user-id', email: 'user@example.com' });
    },
  });

  await client.updatePassword('NewSecure1!', { currentPassword: 'Current123!' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://project.supabase.co/auth/v1/user');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    password: 'NewSecure1!',
    current_password: 'Current123!',
  });
});

test('explicit local-first logout reports remote failure after clearing all Auth browser state', async () => {
  const storage = createStorage({
    [AUTH_SESSION_STORAGE_KEY]: JSON.stringify(session()),
    [AUTH_PKCE_STORAGE_KEY]: 'stale-pkce',
    [AUTH_RETURN_STORAGE_KEY]: 'registro.html',
  });
  const client = createClient({
    storage,
    fetch: async () => response({ message: 'logout unavailable' }, { ok: false, status: 503 }),
  });

  const result = await client.signOut({ suppressRemoteError: true });
  assert.deepEqual(result, { remoteRevoked: false });
  assert.equal(storage.getItem(AUTH_SESSION_STORAGE_KEY), null);
  assert.equal(storage.getItem(AUTH_PKCE_STORAGE_KEY), null);
  assert.equal(storage.getItem(AUTH_RETURN_STORAGE_KEY), null);
});
