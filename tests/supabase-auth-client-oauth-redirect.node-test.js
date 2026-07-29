import assert from 'node:assert/strict';
import test from 'node:test';

import { SupabaseAuthClient } from '../public/supabase-auth-client.js';

function createStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };
}

test('redirects a supported Google OAuth request through the browser location boundary', async () => {
  const assigned = [];
  const client = new SupabaseAuthClient({
    supabaseUrl: 'https://project.supabase.co',
    publishableKey: 'sb_publishable_key',
    publicSiteUrl: 'https://example.com/106',
  }, {
    fetch: async () => { throw new Error('OAuth redirect must not call fetch.'); },
    storage: createStorage(),
    location: {
      href: 'https://example.com/106/login.html',
      assign(value) { assigned.push(value); },
    },
    history: {},
    crypto: {
      getRandomValues(bytes) { bytes.fill(7); return bytes; },
      subtle: { async digest() { return new Uint8Array([1, 2, 3]).buffer; } },
    },
    now: () => 1_000_000,
  });

  const authorizationUrl = await client.signInWithOAuth('google');

  assert.deepEqual(assigned, [authorizationUrl]);
  const parsed = new URL(authorizationUrl);
  assert.equal(parsed.searchParams.get('provider'), 'google');
  assert.equal(parsed.searchParams.get('redirect_to'), 'https://example.com/106/cuenta.html');
  assert.equal(parsed.searchParams.get('code_challenge_method'), 's256');
});
