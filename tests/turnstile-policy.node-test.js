import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createTurnstilePolicy,
  TURNSTILE_MAX_AGE_SECONDS,
  TURNSTILE_RANKED_ACTION,
} from '../supabase/functions/_shared/turnstile-policy.js';

const NOW = Date.parse('2026-08-02T00:00:00.000Z');

function response(result, options = {}) {
  return {
    ok: options.ok ?? true,
    json: options.json ?? (async () => result),
  };
}

function liveResult(overrides = {}) {
  return {
    success: true,
    action: TURNSTILE_RANKED_ACTION,
    hostname: 'example.com',
    challenge_ts: new Date(NOW - 1_000).toISOString(),
    ...overrides,
  };
}

test('exports stable ranked defaults', () => {
  assert.equal(TURNSTILE_RANKED_ACTION, 'ranked-attempt');
  assert.equal(TURNSTILE_MAX_AGE_SECONDS, 300);
});

test('validates dependency contracts', () => {
  assert.throws(() => createTurnstilePolicy({ fetchImpl: 42 }), /fetchImpl/);
  assert.throws(() => createTurnstilePolicy({ now: 42 }), /now/);
});

test('fails closed in production and can skip only explicit non-production optional mode', async () => {
  const production = createTurnstilePolicy({ environment: ' Production ', fetchImpl: async () => response({}) });
  assert.equal(production.required, true);
  assert.deepEqual(await production.verify({}), {
    ok: false,
    code: 'turnstile_configuration',
    providerErrors: [],
  });

  const explicitlyRequired = createTurnstilePolicy({ required: 'TRUE', fetchImpl: async () => response({}) });
  assert.equal(explicitlyRequired.required, true);

  const optional = createTurnstilePolicy({ required: 'false', fetchImpl: async () => response({}) });
  assert.equal(optional.required, false);
  assert.deepEqual(await optional.verify({}), { ok: true, skipped: true });
});

test('local test mode is origin-bound and accepts only explicit non-secret test tokens', async () => {
  const policy = createTurnstilePolicy({
    testMode: 'true',
    fetchImpl: async () => response({}),
  });
  assert.equal(policy.testMode, true);

  for (const origin of ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000']) {
    assert.deepEqual(
      await policy.verify({ token: 'test-valid:abcdefgh', origin }),
      { ok: true, token: 'test-valid:abcdefgh', testMode: true },
    );
  }
  assert.equal((await policy.verify({ token: 'test-valid:abcdefgh', origin: 'https://example.com' })).code, 'turnstile_test_origin');
  assert.equal((await policy.verify({ token: 'test-valid:abcdefgh', origin: 'not a url' })).code, 'turnstile_test_origin');
  assert.equal((await policy.verify({ token: 'invalid', origin: 'http://localhost:3000' })).code, 'turnstile_invalid');
  assert.equal((await policy.verify({ token: 123, origin: 'http://localhost:3000' })).code, 'turnstile_invalid');
});

test('handles provider transport and response failures deterministically', async () => {
  const base = {
    secret: 'secret',
    expectedHostnames: 'example.com',
    now: () => NOW,
  };
  const missing = createTurnstilePolicy({ ...base, fetchImpl: async () => response({}) });
  assert.equal((await missing.verify({ token: '' })).code, 'turnstile_missing');

  const unavailable = createTurnstilePolicy({ ...base, fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal((await unavailable.verify({ token: 'token' })).code, 'turnstile_unavailable');

  const invalidJson = createTurnstilePolicy({
    ...base,
    fetchImpl: async () => response({}, { json: async () => { throw new Error('bad json'); } }),
  });
  assert.equal((await invalidJson.verify({ token: 'token' })).code, 'turnstile_invalid_response');

  const nonOk = createTurnstilePolicy({
    ...base,
    fetchImpl: async () => response({ success: true, 'error-codes': ['bad-request'] }, { ok: false }),
  });
  assert.deepEqual(await nonOk.verify({ token: 'token' }), {
    ok: false,
    code: 'turnstile_rejected',
    providerErrors: ['bad-request'],
  });

  const rejected = createTurnstilePolicy({
    ...base,
    fetchImpl: async () => response({ success: false, 'error-codes': 'invalid' }),
  });
  assert.deepEqual(await rejected.verify({ token: 'token' }), {
    ok: false,
    code: 'turnstile_rejected',
    providerErrors: [],
  });
});

test('validates action, hostname and challenge freshness before accepting', async () => {
  const verify = async (result, options = {}) => {
    const policy = createTurnstilePolicy({
      secret: 'secret',
      expectedAction: options.expectedAction ?? TURNSTILE_RANKED_ACTION,
      expectedHostnames: options.expectedHostnames ?? ['example.com'],
      maxAgeSeconds: options.maxAgeSeconds,
      now: () => NOW,
      fetchImpl: async (_url, request) => {
        assert.equal(request.method, 'POST');
        assert.equal(request.headers['content-type'], 'application/x-www-form-urlencoded');
        assert.match(String(request.body), /secret=secret/);
        assert.match(String(request.body), /response=token/);
        assert.match(String(request.body), /remoteip=127.0.0.1/);
        return response(result);
      },
    });
    return policy.verify({ token: ' token ', ip: '127.0.0.1' });
  };

  assert.equal((await verify(liveResult({ action: 'other' }))).code, 'turnstile_action');
  assert.equal((await verify(liveResult({ hostname: 'other.example' }))).code, 'turnstile_hostname');
  assert.equal((await verify(liveResult({ challenge_ts: 'invalid' }))).code, 'turnstile_expired');
  assert.equal((await verify(liveResult({ challenge_ts: new Date(NOW + 31_000).toISOString() }))).code, 'turnstile_expired');
  assert.equal((await verify(liveResult({ challenge_ts: new Date(NOW - 61_000).toISOString() }), { maxAgeSeconds: 60 })).code, 'turnstile_expired');

  const accepted = await verify(liveResult({ hostname: 'EXAMPLE.COM' }), { maxAgeSeconds: 0 });
  assert.deepEqual(accepted, {
    ok: true,
    token: 'token',
    hostname: 'example.com',
    action: TURNSTILE_RANKED_ACTION,
    challengeTime: NOW - 1_000,
  });

  const unrestrictedHostname = await verify(liveResult({ hostname: '' }), { expectedHostnames: [] });
  assert.equal(unrestrictedHostname.ok, true);
});
