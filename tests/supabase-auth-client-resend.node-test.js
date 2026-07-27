import assert from 'node:assert/strict';
import test from 'node:test';

import { SupabaseAuthClient } from '../public/supabase-auth-client.js';

function response(payload) {
  return {
    ok: true,
    status: 200,
    async json() { return payload; },
  };
}

function createClient() {
  const calls = [];
  const responses = [response({ first: true }), response({ second: true })];
  const fetch = async (...args) => {
    calls.push(args);
    return responses.shift();
  };
  const client = new SupabaseAuthClient({
    supabaseUrl: 'https://project.supabase.co',
    publishableKey: 'sb_publishable_key',
    publicSiteUrl: 'https://example.com/106',
  }, {
    fetch,
    storage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    location: { href: 'https://example.com/106/cuenta.html', assign() {} },
    history: { replaceState() {} },
    crypto: globalThis.crypto,
    now: () => 1_000_000,
  });
  return { client, calls };
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
