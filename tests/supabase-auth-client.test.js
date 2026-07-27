import { describe, expect, it, vi } from 'vitest';

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

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key) => values.get(key) ?? null),
    setItem: vi.fn((key, value) => values.set(key, value)),
    removeItem: vi.fn((key) => values.delete(key)),
    values,
  };
}

function response(payload, ok = true, status = 200) {
  return {
    ok,
    status,
    json: vi.fn().mockResolvedValue(payload),
  };
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

function client(dependencies = {}) {
  return new SupabaseAuthClient({
    supabaseUrl: 'https://project.supabase.co',
    publishableKey: 'sb_publishable_key',
    publicSiteUrl: 'https://example.com/106',
  }, {
    fetch: vi.fn(),
    storage: storage(),
    location: { href: 'https://example.com/106/cuenta.html', assign: vi.fn() },
    history: { replaceState: vi.fn() },
    crypto: {
      getRandomValues: (bytes) => bytes.fill(7),
      subtle: { digest: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer) },
    },
    now: () => 1_000_000,
    ...dependencies,
  });
}

describe('PKCE and session primitives', () => {
  it('creates URL-safe verifier and challenge values', async () => {
    const cryptoApi = {
      getRandomValues: (bytes) => bytes.fill(255),
      subtle: { digest: vi.fn().mockResolvedValue(new Uint8Array([251, 255, 239]).buffer) },
    };
    expect(createCodeVerifier(cryptoApi)).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(await codeChallenge('verifier', cryptoApi)).toBe('-__v');
    expect(cryptoApi.subtle.digest).toHaveBeenCalledWith('SHA-256', expect.any(Uint8Array));
  });

  it('normalizes valid sessions and rejects incomplete payloads', () => {
    expect(normalizeSession(session())).toEqual(session());
    expect(normalizeSession({ ...session(), expires_at: 0, expires_in: 3600 }).expires_at).toBeGreaterThan(0);
    expect(normalizeSession(null)).toBeNull();
    expect(normalizeSession({ refresh_token: 'r', user: {} })).toBeNull();
    expect(normalizeSession({ access_token: 'a', user: {} })).toBeNull();
    expect(normalizeSession({ access_token: 'a', refresh_token: 'r' })).toBeNull();
  });

  it('extracts callback codes only from valid URLs', () => {
    expect(callbackCode('https://example.com/?code=abc')).toBe('abc');
    expect(callbackCode('https://example.com/')).toBe('');
    expect(callbackCode('not a url')).toBe('');
  });
});

describe('SupabaseAuthClient', () => {
  it('builds authenticated headers and returns successful JSON', async () => {
    const fetch = vi.fn().mockResolvedValue(response({ ok: true }));
    const auth = client({ fetch });
    await expect(auth.request('/test', {
      method: 'PUT',
      session: session(),
      headers: { 'x-extra': 'yes' },
      body: { value: 1 },
    })).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledWith('https://project.supabase.co/auth/v1/test', {
      method: 'PUT',
      headers: {
        apikey: 'sb_publishable_key',
        'content-type': 'application/json',
        authorization: 'Bearer access',
        'x-extra': 'yes',
      },
      body: '{"value":1}',
    });
  });

  it('maps failed and non-JSON responses to typed errors', async () => {
    const failed = response({ error_code: 'bad_code', msg: 'Bad auth' }, false, 401);
    const auth = client({ fetch: vi.fn().mockResolvedValue(failed) });
    await expect(auth.request('/test')).rejects.toMatchObject({ message: 'Bad auth', code: 'bad_code', status: 401 });

    const empty = { ok: false, status: 500, json: vi.fn().mockRejectedValue(new Error('invalid')) };
    const emptyClient = client({ fetch: vi.fn().mockResolvedValue(empty) });
    await expect(emptyClient.request('/test')).rejects.toMatchObject({ message: 'Auth request failed', code: 'auth_error', status: 500 });
  });

  it('persists, reads and clears sessions safely', () => {
    const local = storage();
    const auth = client({ storage: local });
    expect(auth.readSession()).toBeNull();
    expect(auth.writeSession(session())).toEqual(session());
    expect(JSON.parse(local.values.get(AUTH_SESSION_STORAGE_KEY))).toEqual(session());
    expect(auth.readSession()).toEqual(session());
    local.values.set(AUTH_SESSION_STORAGE_KEY, '{broken');
    expect(auth.readSession()).toBeNull();
    expect(auth.writeSession({})).toBeNull();
    auth.clearSession();
    expect(local.values.has(AUTH_SESSION_STORAGE_KEY)).toBe(false);
  });

  it('refreshes expiring sessions and clears failed refreshes', async () => {
    const expiring = session({ expires_at: 1001 });
    const local = storage({ [AUTH_SESSION_STORAGE_KEY]: JSON.stringify(expiring) });
    const fetch = vi.fn().mockResolvedValue(response(session({ access_token: 'new' })));
    const auth = client({ storage: local, fetch, now: () => 1_000_000 });
    await expect(auth.currentSession()).resolves.toMatchObject({ access_token: 'new' });
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('grant_type=refresh_token'), expect.anything());

    const missing = client();
    await expect(missing.refreshSession(null)).resolves.toBeNull();

    const failingStorage = storage({ [AUTH_SESSION_STORAGE_KEY]: JSON.stringify(expiring) });
    const failing = client({ storage: failingStorage, fetch: vi.fn().mockResolvedValue(response({ message: 'failed' }, false, 400)) });
    await expect(failing.refreshSession(expiring)).rejects.toThrow('failed');
    expect(failingStorage.values.has(AUTH_SESSION_STORAGE_KEY)).toBe(false);
  });

  it('creates and consumes PKCE state', async () => {
    const local = storage();
    const auth = client({ storage: local });
    const result = await auth.createPkce('restablecer-clave.html');
    expect(result.verifier).toBeTruthy();
    expect(result.challenge).toBe('AQID');
    expect(local.values.get(AUTH_RETURN_STORAGE_KEY)).toBe('restablecer-clave.html');
    expect(auth.consumePkce()).toBe(result.verifier);
    expect(auth.consumePkce()).toBe('');
    expect(auth.consumeReturnPage()).toBe('restablecer-clave.html');
    expect(auth.consumeReturnPage()).toBe('cuenta.html');
  });

  it('exchanges callback codes, stores the session and removes callback parameters', async () => {
    const local = storage({ [AUTH_PKCE_STORAGE_KEY]: 'verifier' });
    const history = { replaceState: vi.fn() };
    const fetch = vi.fn().mockResolvedValue(response(session()));
    const auth = client({ local, storage: local, fetch, history });
    await expect(auth.exchangeCallback('https://example.com/106/cuenta.html?code=abc&type=recovery#x')).resolves.toEqual(session());
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('grant_type=pkce'), expect.objectContaining({ body: '{"auth_code":"abc","code_verifier":"verifier"}' }));
    expect(history.replaceState).toHaveBeenCalledWith({}, '', '/106/cuenta.html#x');

    const noCode = client();
    vi.spyOn(noCode, 'currentSession').mockResolvedValue(null);
    await expect(noCode.exchangeCallback('https://example.com/')).resolves.toBeNull();

    const missingVerifier = client();
    await expect(missingVerifier.exchangeCallback('https://example.com/?code=abc')).rejects.toThrow('verificador seguro');
  });

  it('builds and redirects to Google and Facebook PKCE authorization URLs', async () => {
    const location = { href: 'https://example.com/106/cuenta.html', assign: vi.fn() };
    const auth = client({ location });
    const google = await auth.signInWithOAuth('google', { skipRedirect: true });
    expect(google).toContain('provider=google');
    expect(google).toContain('code_challenge=AQID');
    expect(location.assign).not.toHaveBeenCalled();
    const facebook = await auth.signInWithOAuth('facebook');
    expect(facebook).toContain('provider=facebook');
    expect(location.assign).toHaveBeenCalledWith(facebook);
    await expect(auth.signInWithOAuth('github')).rejects.toThrow('Proveedor OAuth no válido');
  });

  it('registers, signs in and starts recovery with normalized email and CAPTCHA', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({ user: { id: 1 } }))
      .mockResolvedValueOnce(response(session()))
      .mockResolvedValueOnce(response({}));
    const auth = client({ fetch });
    await expect(auth.signUp(' User@Example.com ', 'Password123!', { captchaToken: 'captcha' })).resolves.toEqual({ user: { id: 1 } });
    expect(fetch.mock.calls[0][1].body).toContain('gotrue_meta_security');
    await expect(auth.signInWithPassword('user@example.com', 'Password123!', { captchaToken: 'captcha' })).resolves.toEqual(session());
    expect(auth.readSession()).toEqual(session());
    await expect(auth.requestPasswordRecovery('user@example.com', { captchaToken: 'captcha' })).resolves.toEqual({});
    expect(fetch.mock.calls[2][0]).toContain('/recover?redirect_to=');

    await expect(auth.signUp('bad', 'Password123!')).rejects.toThrow('email válido');
    await expect(auth.signInWithPassword('bad', 'Password123!')).rejects.toThrow('email válido');
    await expect(auth.requestPasswordRecovery('bad')).rejects.toThrow('email válido');
  });

  it('stores direct signup sessions, updates passwords and signs out robustly', async () => {
    const direct = session();
    const fetch = vi.fn()
      .mockResolvedValueOnce(response(direct))
      .mockResolvedValueOnce(response({ id: 'user-id', email: 'user@example.com' }))
      .mockResolvedValueOnce(response({}));
    const local = storage();
    const auth = client({ fetch, storage: local });
    await auth.signUp('user@example.com', 'Password123!');
    expect(auth.readSession()).toEqual(direct);
    await expect(auth.updatePassword('NewPassword123!')).resolves.toMatchObject({ id: 'user-id' });
    expect(auth.readSession().user.id).toBe('user-id');
    await auth.signOut();
    expect(auth.readSession()).toBeNull();

    const noSession = client();
    await expect(noSession.updatePassword('Password123!')).rejects.toThrow('sesión de recuperación');
    await expect(noSession.signOut()).resolves.toBeUndefined();

    const localFail = storage({ [AUTH_SESSION_STORAGE_KEY]: JSON.stringify(session()) });
    const fail = client({ storage: localFail, fetch: vi.fn().mockResolvedValue(response({ message: 'logout failed' }, false, 500)) });
    await expect(fail.signOut()).rejects.toThrow('logout failed');
    expect(localFail.values.has(AUTH_SESSION_STORAGE_KEY)).toBe(false);
  });
});
