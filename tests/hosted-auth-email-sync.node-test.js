import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildHostedAuthConfiguration,
  hostedAuthEmailDrift,
  hostedAuthEmailSyncEnvironment,
  synchronizeHostedAuthEmails,
} from '../scripts/hosted-auth-email-sync.mjs';

function response(body, { ok = true, status = 200, invalidJson = false, rejectText = false } = {}) {
  return {
    ok,
    status,
    async text() {
      if (rejectText) throw new Error('text unavailable');
      return typeof body === 'string' ? body : JSON.stringify(body);
    },
    async json() {
      if (invalidJson) throw new Error('invalid json');
      return body;
    },
  };
}

function createFetch(...responses) {
  const queue = [...responses];
  const calls = [];
  const fetchFn = async (...arguments_) => {
    calls.push(arguments_);
    const next = queue.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  fetchFn.calls = calls;
  return fetchFn;
}

test('builds one hosted payload containing templates and canonical OTP policy', () => {
  const config = buildHostedAuthConfiguration({
    emailConfig: { subject: 'Hola' },
    authEmailPolicy: { otpLength: 8, otpExpirySeconds: 3600 },
  });
  assert.deepEqual(config, {
    subject: 'Hola',
    mailer_otp_length: 8,
    mailer_otp_exp: 3600,
  });
  assert.ok(Object.isFrozen(config));

  const canonical = buildHostedAuthConfiguration();
  assert.equal(canonical.mailer_otp_length, 8);
  assert.equal(canonical.mailer_otp_exp, 3600);
  assert.match(canonical.mailer_templates_confirmation_content, /MINUTO 106/u);
});

test('reads protected environment values and rejects missing configuration', () => {
  assert.deepEqual(hostedAuthEmailSyncEnvironment({
    SUPABASE_PROJECT_ID: ' project ',
    SUPABASE_ACCESS_TOKEN: ' token ',
  }), { projectId: 'project', accessToken: 'token' });
  assert.deepEqual(hostedAuthEmailSyncEnvironment({
    PROJECT_ID: 'fallback-project',
    SUPABASE_ACCESS_TOKEN: 'token',
  }), { projectId: 'fallback-project', accessToken: 'token' });
  assert.throws(() => hostedAuthEmailSyncEnvironment({ SUPABASE_ACCESS_TOKEN: 'token' }), /project/i);
  assert.throws(() => hostedAuthEmailSyncEnvironment({ PROJECT_ID: 'project' }), /access token/i);
});

test('reports exact sorted managed-key drift with safe object fallbacks', () => {
  assert.deepEqual(hostedAuthEmailDrift({ beta: true, alpha: '<p>x</p>' }, {
    alpha: '<p>x</p>',
    beta: false,
  }), ['beta']);
  assert.deepEqual(hostedAuthEmailDrift({ zeta: 1, alpha: 2 }, null), ['alpha', 'zeta']);
  assert.deepEqual(hostedAuthEmailDrift(null, { alpha: 1 }), []);
});

test('performs no PATCH when hosted configuration already matches', async () => {
  const expected = { subject: 'Hola', enabled: true };
  const fetchFn = createFetch(response({ ...expected, unrelated: 'preserved' }));
  const result = await synchronizeHostedAuthEmails({
    fetchFn,
    projectId: 'project/id',
    accessToken: 'secret-token',
    expected,
  });
  assert.deepEqual(result, { changed: false, drift: [], verified: true });
  assert.equal(fetchFn.calls.length, 1);
  assert.equal(fetchFn.calls[0][0], 'https://api.supabase.com/v1/projects/project%2Fid/config/auth');
  assert.equal(fetchFn.calls[0][1].method, 'GET');
  assert.equal(fetchFn.calls[0][1].headers.authorization, 'Bearer secret-token');
  assert.equal(fetchFn.calls[0][1].body, undefined);
});

test('fails closed on drift in check mode without exposing payload values', async () => {
  const expected = { mailer_templates_confirmation_content: '<p>secret html</p>' };
  const fetchFn = createFetch(response({ mailer_templates_confirmation_content: '<p>old</p>' }));
  await assert.rejects(
    synchronizeHostedAuthEmails({ fetchFn, projectId: 'project', accessToken: 'token', expected }),
    (error) => {
      assert.match(error.message, /mailer_templates_confirmation_content/u);
      assert.doesNotMatch(error.message, /secret html/u);
      return true;
    },
  );
  assert.equal(fetchFn.calls.length, 1);
});

test('applies only the managed payload and verifies convergence', async () => {
  const expected = { subject: 'Nuevo', enabled: true };
  const fetchFn = createFetch(
    response({ subject: 'Viejo', enabled: false }),
    response(null),
    response({ ...expected, unrelated: 1 }),
  );
  const result = await synchronizeHostedAuthEmails({
    fetchFn,
    projectId: 'project',
    accessToken: 'token',
    expected,
    apply: true,
    apiBaseUrl: 'https://management.example.test/',
  });
  assert.deepEqual(result, {
    changed: true,
    drift: ['enabled', 'subject'],
    verified: true,
  });
  assert.equal(fetchFn.calls.length, 3);
  assert.equal(fetchFn.calls[1][1].method, 'PATCH');
  assert.equal(fetchFn.calls[1][1].headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(fetchFn.calls[1][1].body), expected);
  assert.equal(fetchFn.calls[2][1].method, 'GET');
});

test('rejects invalid dependencies, identifiers and Management API responses', async () => {
  await assert.rejects(synchronizeHostedAuthEmails({ fetchFn: null, projectId: 'p', accessToken: 't' }), /fetch implementation/u);
  await assert.rejects(synchronizeHostedAuthEmails({ fetchFn: () => {}, accessToken: 't' }), /project ID/u);
  await assert.rejects(synchronizeHostedAuthEmails({ fetchFn: () => {}, projectId: 'p' }), /access token/u);
  await assert.rejects(synchronizeHostedAuthEmails({
    fetchFn: () => {}, projectId: 'p', accessToken: 't', apiBaseUrl: 'invalid',
  }), /base URL/u);

  const invalidJsonFetch = createFetch(response('not-json', { invalidJson: true }));
  await assert.rejects(synchronizeHostedAuthEmails({
    fetchFn: invalidJsonFetch, projectId: 'p', accessToken: 't', expected: {},
  }), /invalid JSON object/u);

  const arrayFetch = createFetch(response([]));
  await assert.rejects(synchronizeHostedAuthEmails({
    fetchFn: arrayFetch, projectId: 'p', accessToken: 't', expected: {},
  }), /invalid JSON object/u);
});

test('reports bounded API failures, customization guidance and persistent drift', async () => {
  const forbidden = createFetch(response(`  forbidden ${'x'.repeat(800)}  `, { ok: false, status: 403 }));
  await assert.rejects(synchronizeHostedAuthEmails({
    fetchFn: forbidden,
    projectId: 'project',
    accessToken: 'token',
    expected: { subject: 'new' },
    apply: true,
  }), (error) => {
    assert.match(error.message, /custom SMTP/u);
    assert.ok(error.message.length < 900);
    return true;
  });

  const serverFailure = createFetch(response('', { ok: false, status: 500, rejectText: true }));
  await assert.rejects(synchronizeHostedAuthEmails({
    fetchFn: serverFailure,
    projectId: 'project',
    accessToken: 'token',
    expected: {},
  }), (error) => {
    assert.match(error.message, /HTTP 500/u);
    assert.doesNotMatch(error.message, /custom SMTP/u);
    return true;
  });

  const persistent = createFetch(
    response({ subject: 'old' }),
    response({}),
    response({ subject: 'still-old' }),
  );
  await assert.rejects(synchronizeHostedAuthEmails({
    fetchFn: persistent,
    projectId: 'project',
    accessToken: 'token',
    expected: { subject: 'new' },
    apply: true,
  }), /did not converge.*subject/u);
});
