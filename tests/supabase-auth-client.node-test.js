import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SupabaseAuthClient,
  callbackCode,
  codeChallenge,
  createCodeVerifier,
  normalizeSession,
} from '../public/supabase-auth-client.js';
import {
  AUTH_PKCE_STORAGE_KEY,
  AUTH_RETURN_STORAGE_KEY,
  AUTH_SESSION_STORAGE_KEY,
} from '../public/auth-account-state.js';

const unsupportedSocialProvider = ['face', 'book'].join('');

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };
}

function response(payload, { ok = true, status = 200, rejectJson = false } = {}) {
  return {
    ok,
    status,
    async json() {
      if (rejectJson) throw new Error('invalid json');
      return payload;
    },
  };
}

function createFetch(...responses) {
  const calls = [];
  const queue = [...responses];
  const fetch = async (...args) => {
    calls.push(args);
    const next = queue.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  fetch.calls = calls;
  return fetch;
}

function session(overrides = {}) {
  return {
    access_token: 'access',
    refresh_token: 'refresh',
    expires_at: 2_000_000_000,
    token_type: 'bearer',
    user: { id: 'user-id', email: 'user@example.com' },
    ...overrides,
  };
}

function createClient(overrides = {}) {
  const dependencies = {
    fetch: createFetch(),
    storage: createStorage(),
    location: {
      href: 'https://example.com/106/cuenta.html',
      assigned: [],
      assign(value) { this.assigned.push(value); },
    },
    history: {
      calls: [],
      replaceState(...args) { this.calls.push(args); },
    },
    crypto: {
      getRandomValues(bytes) { bytes.fill(7); return bytes; },
      subtle: { async digest() { return new Uint8Array([1, 2, 3]).buffer; } },
    },
    now: () => 1_000_000,
    ...overrides,
  };
  return {
    client: new SupabaseAuthClient({
      supabaseUrl: 'https://project.supabase.co',
      publishableKey: 'sb_publishable_key',
      publicSiteUrl: 'https://example.com/106',
    }, dependencies),
    dependencies,
  };
}

test('creates URL-safe PKCE verifier and challenge values', async () => {
  const cryptoApi = {
    getRandomValues(bytes) { bytes.fill(255); return bytes; },
    subtle: {
      async digest(algorithm, input) {
        assert.equal(algorithm, 'SHA-256');
        assert.ok(input instanceof Uint8Array);
        return new Uint8Array([251, 255, 239]).buffer;
      },
    },
  };
  assert.match(createCodeVerifier(cryptoApi), /^[A-Za-z0-9_-]+$/);
  assert.equal(await codeChallenge('verifier', cryptoApi), '-__v');
});

test('normalizes valid sessions and rejects every incomplete shape', () => {
  assert.deepEqual(normalizeSession(session()), session());
  const relative = normalizeSession({ ...session(), expires_at: 0, expires_in: 3600 });
  assert.ok(relative.expires_at > 0);
  assert.equal(normalizeSession(null), null);
  assert.equal(normalizeSession('invalid'), null);
  assert.equal(normalizeSession({ refresh_token: 'r', user: {} }), null);
  assert.equal(normalizeSession({ access_token: 'a', user: {} }), null);
  assert.equal(normalizeSession({ access_token: 'a', refresh_token: 'r' }), null);
  assert.equal(normalizeSession({ ...session(), expires_at: Number.POSITIVE_INFINITY }), null);
  assert.equal(normalizeSession({ ...session(), token_type: '' }).token_type, 'bearer');
});

test('extracts callback codes only from valid URLs', () => {
  assert.equal(callbackCode('https://example.com/?code=abc'), 'abc');
  assert.equal(callbackCode('https://example.com/'), '');
  assert.equal(callbackCode('not a url'), '');
});

test('uses browser defaults only when no dependencies are supplied', () => {
  const priorWindow = globalThis.window;
  const priorCrypto = globalThis.crypto;
  const fakeWindow = {
    fetch() {},
    localStorage: createStorage(),
    location: { href: 'https://example.com/' },
    history: {},
  };
  globalThis.window = fakeWindow;
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { marker: true } });
  try {
    const auth = new SupabaseAuthClient({ supabaseUrl: 'u', publishableKey: 'k', publicSiteUrl: 'p' });
    assert.equal(typeof auth.fetch, 'function');
    assert.equal(auth.storage, fakeWindow.localStorage);
    assert.equal(auth.location, fakeWindow.location);
    assert.equal(auth.history, fakeWindow.history);
    assert.deepEqual(auth.crypto, { marker: true });
    assert.ok(Number.isFinite(auth.now()));
  } finally {
    globalThis.window = priorWindow;
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: priorCrypto });
  }
});

test('builds URLs, public and authenticated headers', () => {
  const { client } = createClient();
  assert.equal(client.authUrl('/test'), 'https://project.supabase.co/auth/v1/test');
  assert.deepEqual(client.headers(null), {
    apikey: 'sb_publishable_key',
    'content-type': 'application/json',
  });
  assert.deepEqual(client.headers(session(), { 'x-extra': 'yes' }), {
    apikey: 'sb_publishable_key',
    'content-type': 'application/json',
    'x-extra': 'yes',
    authorization: 'Bearer access',
  });
});

test('performs successful requests with default and custom options', async () => {
  const fetch = createFetch(response({ first: true }), response({ second: true }));
  const { client } = createClient({ fetch });
  assert.deepEqual(await client.request('/one'), { first: true });
  assert.deepEqual(fetch.calls[0], ['https://project.supabase.co/auth/v1/one', {
    method: 'POST',
    headers: { apikey: 'sb_publishable_key', 'content-type': 'application/json' },
    body: undefined,
  }]);
  assert.deepEqual(await client.request('/two', {
    method: 'PUT',
    session: session(),
    headers: { 'x-extra': 'yes' },
    body: { value: 1 },
  }), { second: true });
  assert.equal(fetch.calls[1][1].body, '{"value":1}');
  assert.equal(fetch.calls[1][1].headers.authorization, 'Bearer access');
});

test('maps all supported failed response message and code fallbacks', async () => {
  const cases = [
    [{ msg: 'msg', error_code: 'error-code' }, 'msg', 'error-code'],
    [{ message: 'message', code: 'code' }, 'message', 'code'],
    [{ error_description: 'description', error: 'error' }, 'description', 'error'],
    [{ error: 'plain-error' }, 'plain-error', 'plain-error'],
    [{}, 'Auth request failed', 'auth_error'],
  ];
  for (const [payload, expectedMessage, expectedCode] of cases) {
    const { client } = createClient({
      fetch: createFetch(response(payload, { ok: false, status: 401 })),
    });
    await assert.rejects(client.request('/test'), (error) => {
      assert.equal(error.message, expectedMessage);
      assert.equal(error.code, expectedCode);
      assert.equal(error.status, 401);
      return true;
    });
  }
  const { client } = createClient({
    fetch: createFetch(response(null, { ok: false, status: 500, rejectJson: true })),
  });
  await assert.rejects(client.request('/test'), /Auth request failed/);
});

test('reads, writes and clears sessions safely', () => {
  const storage = createStorage();
  const { client } = createClient({ storage });
  assert.equal(client.readSession(), null);
  assert.deepEqual(client.writeSession(session()), session());
  assert.deepEqual(JSON.parse(storage.values.get(AUTH_SESSION_STORAGE_KEY)), session());
  assert.deepEqual(client.readSession(), session());
  storage.values.set(AUTH_SESSION_STORAGE_KEY, '{broken');
  assert.equal(client.readSession(), null);
  assert.equal(client.writeSession({}), null);
  assert.equal(storage.values.has(AUTH_SESSION_STORAGE_KEY), false);
  client.clearSession();
  assert.equal(storage.values.has(AUTH_SESSION_STORAGE_KEY), false);
});

test('refreshes, preserves and clears sessions across all timing states', async () => {
  const freshStorage = createStorage({ [AUTH_SESSION_STORAGE_KEY]: JSON.stringify(session()) });
  const { client: fresh } = createClient({ storage: freshStorage });
  assert.deepEqual(await fresh.currentSession(), session());

  const expiring = session({ expires_at: 1001 });
  const storage = createStorage({ [AUTH_SESSION_STORAGE_KEY]: JSON.stringify(expiring) });
  const fetch = createFetch(response(session({ access_token: 'new' })));
  const { client } = createClient({ storage, fetch });
  assert.equal((await client.currentSession()).access_token, 'new');
  assert.equal(JSON.parse(fetch.calls[0][1].body).refresh_token, 'refresh');

  const { client: missing } = createClient();
  assert.equal(await missing.currentSession(), null);
  assert.equal(await missing.refreshSession(null), null);

  const failingStorage = createStorage({ [AUTH_SESSION_STORAGE_KEY]: JSON.stringify(expiring) });
  const { client: failing } = createClient({
    storage: failingStorage,
    fetch: createFetch(response({ message: 'failed' }, { ok: false, status: 400 })),
  });
  await assert.rejects(failing.refreshSession(expiring), /failed/);
  assert.equal(failingStorage.values.has(AUTH_SESSION_STORAGE_KEY), false);
});

test('creates and consumes PKCE state with default return page', async () => {
  const storage = createStorage();
  const { client } = createClient({ storage });
  const explicit = await client.createPkce('restablecer-clave.html');
  assert.ok(explicit.verifier);
  assert.equal(explicit.challenge, 'AQID');
  assert.equal(storage.values.get(AUTH_RETURN_STORAGE_KEY), 'restablecer-clave.html');
  assert.equal(client.consumePkce(), explicit.verifier);
  assert.equal(client.consumePkce(), '');
  assert.equal(client.consumeReturnPage(), 'restablecer-clave.html');
  assert.equal(client.consumeReturnPage(), 'cuenta.html');
  await client.createPkce('');
  assert.equal(storage.values.get(AUTH_RETURN_STORAGE_KEY), 'cuenta.html');
});

test('exchanges callback codes and preserves clean URL state', async () => {
  const storage = createStorage({ [AUTH_PKCE_STORAGE_KEY]: 'verifier' });
  const history = {
    calls: [],
    replaceState(...args) { this.calls.push(args); },
  };
  const fetch = createFetch(response(session()));
  const { client } = createClient({ storage, history, fetch });
  assert.deepEqual(
    await client.exchangeCallback('https://example.com/106/cuenta.html?code=abc&type=recovery&other=yes#x'),
    session(),
  );
  assert.equal(fetch.calls[0][0], 'https://project.supabase.co/auth/v1/token?grant_type=pkce');
  assert.equal(fetch.calls[0][1].body, '{"auth_code":"abc","code_verifier":"verifier"}');
  assert.deepEqual(history.calls[0], [{}, '', '/106/cuenta.html?other=yes#x']);

  const { client: noCode } = createClient({
    storage: createStorage({ [AUTH_SESSION_STORAGE_KEY]: JSON.stringify(session()) }),
  });
  assert.deepEqual(await noCode.exchangeCallback(), session());

  const { client: missingVerifier } = createClient();
  await assert.rejects(
    missingVerifier.exchangeCallback('https://example.com/?code=abc'),
    /verificador seguro/,
  );
});

test('builds Google OAuth URLs and rejects unsupported providers', async () => {
  const location = {
    href: 'https://example.com/106/cuenta.html',
    assigned: [],
    assign(value) { this.assigned.push(value); },
  };
  const { client } = createClient({ location });
  const google = await client.signInWithOAuth('google', {
    skipRedirect: true,
    redirectTo: 'https://custom.example/callback',
  });
  const googleUrl = new URL(google);
  assert.equal(googleUrl.searchParams.get('provider'), 'google');
  assert.equal(googleUrl.searchParams.get('redirect_to'), 'https://custom.example/callback');
  assert.equal(googleUrl.searchParams.get('code_challenge'), 'AQID');
  assert.equal(googleUrl.searchParams.get('code_challenge_method'), 's256');
  assert.deepEqual(location.assigned, []);

  await assert.rejects(client.signInWithOAuth(unsupportedSocialProvider), /Proveedor OAuth no válido/);
  await assert.rejects(client.signInWithOAuth('github'), /Proveedor OAuth no válido/);
  assert.deepEqual(location.assigned, []);
});

test('registers with and without CAPTCHA and persists direct sessions', async () => {
  const directSession = session();
  const fetch = createFetch(response({ user: { id: 1 } }), response(directSession));
  const storage = createStorage();
  const { client } = createClient({ fetch, storage });
  assert.deepEqual(await client.signUp(' User@Example.com ', 'Password123!', {
    captchaToken: 'captcha',
    redirectTo: 'https://custom.example/signup',
  }), { user: { id: 1 } });
  const firstBody = JSON.parse(fetch.calls[0][1].body);
  assert.deepEqual(firstBody.gotrue_meta_security, { captcha_token: 'captcha' });
  assert.ok(fetch.calls[0][0].includes(encodeURIComponent('https://custom.example/signup')));
  assert.equal(storage.values.has(AUTH_SESSION_STORAGE_KEY), false);

  assert.deepEqual(await client.signUp('user@example.com', 'Password123!'), directSession);
  const secondBody = JSON.parse(fetch.calls[1][1].body);
  assert.equal(Object.hasOwn(secondBody, 'gotrue_meta_security'), false);
  assert.deepEqual(client.readSession(), directSession);
  await assert.rejects(client.signUp('bad', 'Password123!'), /email válido/);
});

test('signs in with and without CAPTCHA and rejects invalid email', async () => {
  const fetch = createFetch(response(session()), response(session({ access_token: 'two' })));
  const { client } = createClient({ fetch });
  assert.deepEqual(
    await client.signInWithPassword(' User@Example.com ', 'Password123!', { captchaToken: 'captcha' }),
    session(),
  );
  assert.deepEqual(
    JSON.parse(fetch.calls[0][1].body).gotrue_meta_security,
    { captcha_token: 'captcha' },
  );
  assert.equal(
    (await client.signInWithPassword('user@example.com', 'Password123!')).access_token,
    'two',
  );
  assert.equal(
    Object.hasOwn(JSON.parse(fetch.calls[1][1].body), 'gotrue_meta_security'),
    false,
  );
  await assert.rejects(client.signInWithPassword('bad', 'Password123!'), /email válido/);
});

test('requests password recovery with all redirect and CAPTCHA branches', async () => {
  const fetch = createFetch(response({ first: true }), response({ second: true }));
  const { client } = createClient({ fetch });
  assert.deepEqual(await client.requestPasswordRecovery(' User@Example.com ', {
    captchaToken: 'captcha',
    redirectTo: 'https://custom.example/reset',
  }), { first: true });
  const firstBody = JSON.parse(fetch.calls[0][1].body);
  assert.deepEqual(firstBody.gotrue_meta_security, { captcha_token: 'captcha' });
  assert.ok(fetch.calls[0][0].includes(encodeURIComponent('https://custom.example/reset')));

  assert.deepEqual(await client.requestPasswordRecovery('user@example.com'), { second: true });
  assert.equal(
    Object.hasOwn(JSON.parse(fetch.calls[1][1].body), 'gotrue_meta_security'),
    false,
  );
  assert.ok(
    fetch.calls[1][0].includes(
      encodeURIComponent('https://example.com/106/restablecer-clave.html'),
    ),
  );
  await assert.rejects(client.requestPasswordRecovery('bad'), /email válido/);
});

test('updates password only with a live recovery session', async () => {
  const storage = createStorage({ [AUTH_SESSION_STORAGE_KEY]: JSON.stringify(session()) });
  const fetch = createFetch(response({ id: 'user-id', email: 'changed@example.com' }));
  const { client } = createClient({ storage, fetch });
  assert.deepEqual(await client.updatePassword('NewPassword123!'), {
    id: 'user-id',
    email: 'changed@example.com',
  });
  assert.equal(client.readSession().user.email, 'changed@example.com');
  assert.equal(fetch.calls[0][1].method, 'PUT');
  assert.equal(fetch.calls[0][1].headers.authorization, 'Bearer access');

  const { client: missing } = createClient();
  await assert.rejects(missing.updatePassword('Password123!'), /sesión de recuperación/);
});

test('signs out both present and absent sessions and always clears local state', async () => {
  const storage = createStorage({ [AUTH_SESSION_STORAGE_KEY]: JSON.stringify(session()) });
  const fetch = createFetch(response({}));
  const { client } = createClient({ storage, fetch });
  await client.signOut();
  assert.equal(fetch.calls.length, 1);
  assert.equal(storage.values.has(AUTH_SESSION_STORAGE_KEY), false);

  const { client: absent, dependencies } = createClient();
  await absent.signOut();
  assert.equal(dependencies.fetch.calls.length, 0);

  const failingStorage = createStorage({ [AUTH_SESSION_STORAGE_KEY]: JSON.stringify(session()) });
  const { client: failing } = createClient({
    storage: failingStorage,
    fetch: createFetch(response({ message: 'logout failed' }, { ok: false, status: 500 })),
  });
  await assert.rejects(failing.signOut(), /logout failed/);
  assert.equal(failingStorage.values.has(AUTH_SESSION_STORAGE_KEY), false);
});
