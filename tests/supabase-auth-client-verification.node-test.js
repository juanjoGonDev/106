import assert from 'node:assert/strict';
import test from 'node:test';

import { AUTH_SESSION_STORAGE_KEY } from '../public/auth-account-state.js';
import { SupabaseAuthClient } from '../public/supabase-auth-client.js';

function storage() {
  const values = new Map();
  return {
    values,
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };
}

function session(accessToken = 'verified-access') {
  return {
    access_token: accessToken,
    refresh_token: 'verified-refresh',
    expires_at: 2_000_000_000,
    token_type: 'bearer',
    user: { id: 'verified-user', email: 'user@example.com', email_confirmed_at: '2026-07-28T00:00:00Z' },
  };
}

function clientWithResponses(...payloads) {
  const calls = [];
  const memory = storage();
  const fetch = async (...args) => {
    calls.push(args);
    return {
      ok: true,
      status: 200,
      async json() { return payloads.shift(); },
    };
  };
  const location = {
    href: 'https://example.com/106/registro.html',
    assigned: [],
    assign(value) { this.assigned.push(value); },
  };
  const client = new SupabaseAuthClient({
    supabaseUrl: 'https://project.supabase.co',
    publishableKey: 'sb_publishable_key',
    publicSiteUrl: 'https://example.com/106',
  }, {
    fetch,
    storage: memory,
    location,
    history: { replaceState() {} },
    crypto: {
      getRandomValues(bytes) { bytes.fill(1); return bytes; },
      subtle: { async digest() { return new Uint8Array([1, 2, 3]).buffer; } },
    },
  });
  return { client, calls, memory, location };
}

test('verifies a six-digit signup code and persists the confirmed session', async () => {
  const expected = session('otp-access');
  const { client, calls, memory } = clientWithResponses(expected);
  assert.deepEqual(await client.verifyEmailOtp(' User@Example.com ', ' 123456 '), expected);
  assert.equal(calls[0][0], 'https://project.supabase.co/auth/v1/verify');
  assert.deepEqual(JSON.parse(calls[0][1].body), {
    email: 'user@example.com',
    token: '123456',
    type: 'email',
  });
  assert.deepEqual(JSON.parse(memory.values.get(AUTH_SESSION_STORAGE_KEY)), expected);
});

test('rejects missing email and every malformed verification code before requesting', async () => {
  const { client, calls } = clientWithResponses();
  await assert.rejects(client.verifyEmailOtp('invalid', '123456'), /email pendiente/);
  for (const token of ['', '12345', '1234567', '12a456', null]) {
    await assert.rejects(client.verifyEmailOtp('user@example.com', token), /6 dígitos/);
  }
  assert.equal(calls.length, 0);
});

test('verifies a token hash and rejects malformed links before requesting', async () => {
  const expected = session('hash-access');
  const validHash = 'a'.repeat(24);
  const { client, calls, memory } = clientWithResponses(expected);
  assert.deepEqual(await client.verifyTokenHash(` ${validHash} `), expected);
  assert.deepEqual(JSON.parse(calls[0][1].body), {
    token_hash: validHash,
    type: 'email',
  });
  assert.deepEqual(JSON.parse(memory.values.get(AUTH_SESSION_STORAGE_KEY)), expected);

  for (const hash of ['', 'short', 'contains spaces and invalid!', 'a'.repeat(513), null]) {
    const invalid = clientWithResponses();
    await assert.rejects(invalid.client.verifyTokenHash(hash), /enlace de verificación/);
    assert.equal(invalid.calls.length, 0);
  }
});

test('uses the requested OAuth return page without widening the provider allowlist', async () => {
  const { client, location } = clientWithResponses();
  const url = await client.signInWithOAuth('google', {
    returnPage: 'verificar-email.html',
    skipRedirect: true,
  });
  assert.equal(new URL(url).searchParams.get('redirect_to'), 'https://example.com/106/verificar-email.html');
  assert.equal(location.assigned.length, 0);
});