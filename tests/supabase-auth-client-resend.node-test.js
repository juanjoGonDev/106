import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SupabaseAuthClient,
  callbackSessionTokens,
} from '../public/supabase-auth-client.js';
import {
  AUTH_PKCE_STORAGE_KEY,
  AUTH_RETURN_STORAGE_KEY,
  AUTH_SESSION_STORAGE_KEY,
} from '../public/auth-account-state.js';

function response(payload) {
  return {
    ok: true,
    status: 200,
    async json() { return payload; },
  };
}

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };
}

function createClient(options = {}) {
  const calls = [];
  const responses = [...(options.responses || [response({ first: true }), response({ second: true })])];
  const fetch = async (...args) => {
    calls.push(args);
    return responses.shift();
  };
  const storage = options.storage || createStorage();
  const history = options.history || { replaceState() {} };
  const client = new SupabaseAuthClient({
    supabaseUrl: 'https://project.supabase.co',
    publishableKey: 'sb_publishable_key',
    publicSiteUrl: 'https://example.com/106',
  }, {
    fetch,
    storage,
    location: { href: 'https://example.com/106/cuenta.html', assign() {} },
    history,
    crypto: globalThis.crypto,
    now: () => 1_000_000,
  });
  return { client, calls, history, storage };
}

test('resends signup confirmation with custom and default redirect branches', async () => {
  const { client, calls } = createClient();

  assert.deepEqual(await client.resendSignupConfirmation(' User@Example.com ', {
    captchaToken: 'captcha',
    redirectTo: 'https://custom.example/account',
  }), { first: true });
  assert.ok(calls[0][0].includes('/auth/v1/resend?'));
  assert.ok(calls[0][0].includes(encodeURIComponent('https://custom.example/account')));
  assert.deepEqual(JSON.parse(calls[0][1].body), {
    email: 'user@example.com',
    type: 'signup',
    gotrue_meta_security: { captcha_token: 'captcha' },
  });

  assert.deepEqual(await client.resendSignupConfirmation('user@example.com'), { second: true });
  assert.ok(calls[1][0].includes(encodeURIComponent('https://example.com/106/cuenta.html')));
  assert.equal(Object.hasOwn(JSON.parse(calls[1][1].body), 'gotrue_meta_security'), false);

  await assert.rejects(client.resendSignupConfirmation('invalid'), /email válido/);
});

test('parses implicit callback tokens and rejects incomplete or malformed fragments', () => {
  assert.deepEqual(callbackSessionTokens(
    'https://example.com/106/cuenta.html#access_token=access&refresh_token=refresh&expires_in=3600&token_type=custom',
  ), {
    access_token: 'access',
    refresh_token: 'refresh',
    expires_at: undefined,
    expires_in: 3600,
    token_type: 'custom',
  });
  assert.deepEqual(callbackSessionTokens(
    'https://example.com/106/cuenta.html#access_token=access&refresh_token=refresh&expires_at=2000000000',
  ), {
    access_token: 'access',
    refresh_token: 'refresh',
    expires_at: 2_000_000_000,
    expires_in: undefined,
    token_type: 'bearer',
  });
  assert.equal(callbackSessionTokens('not a url'), null);
  assert.equal(callbackSessionTokens('https://example.com/#refresh_token=refresh&expires_in=3600'), null);
  assert.equal(callbackSessionTokens('https://example.com/#access_token=access&expires_in=3600'), null);
  assert.equal(callbackSessionTokens('https://example.com/#access_token=access&refresh_token=refresh'), null);
});

test('exchanges an implicit resend callback, validates the user and removes tokens from the URL', async () => {
  const storage = createStorage({
    [AUTH_PKCE_STORAGE_KEY]: 'stale-verifier',
    [AUTH_RETURN_STORAGE_KEY]: 'cuenta.html',
  });
  const history = {
    calls: [],
    replaceState(...args) { this.calls.push(args); },
  };
  const user = { id: 'user-id', email: 'user@example.com', app_metadata: { provider: 'email' } };
  const { client, calls } = createClient({ storage, history, responses: [response(user)] });

  const session = await client.exchangeCallback(
    'https://example.com/106/cuenta.html?keep=yes#access_token=implicit-access&refresh_token=implicit-refresh&expires_at=2000000000&token_type=bearer&type=signup',
  );

  assert.deepEqual(session, {
    access_token: 'implicit-access',
    refresh_token: 'implicit-refresh',
    expires_at: 2_000_000_000,
    token_type: 'bearer',
    user,
  });
  assert.equal(calls[0][0], 'https://project.supabase.co/auth/v1/user');
  assert.equal(calls[0][1].method, 'GET');
  assert.equal(calls[0][1].headers.authorization, 'Bearer implicit-access');
  assert.equal(calls[0][1].body, undefined);
  assert.deepEqual(history.calls, [[{}, '', '/106/cuenta.html?keep=yes']]);
  assert.equal(storage.values.has(AUTH_PKCE_STORAGE_KEY), false);
  assert.equal(storage.values.has(AUTH_RETURN_STORAGE_KEY), false);
  assert.deepEqual(JSON.parse(storage.values.get(AUTH_SESSION_STORAGE_KEY)), session);
});
