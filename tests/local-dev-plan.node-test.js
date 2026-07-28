import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LOCAL_FUNCTION_ENV,
  LOCAL_FUNCTION_ENV_PATH,
  localAccountUrl,
  localDevelopmentMode,
  localFunctionEnvironmentSource,
  localFunctionHealthUrl,
  localFunctionServeArguments,
  localStartupPlan,
  localSupabaseStartArguments,
  localWebHealthUrl,
} from '../scripts/local-dev-plan.mjs';

test('builds a private deterministic local function environment', () => {
  assert.equal(LOCAL_FUNCTION_ENV_PATH, 'supabase/functions/.env');
  assert.match(localFunctionEnvironmentSource(), /^HASH_PEPPER=/);
  assert.match(localFunctionEnvironmentSource(), /ALLOWED_ORIGINS=http:\/\/127\.0\.0\.1:3000,http:\/\/localhost:3000/);
  assert.match(localFunctionEnvironmentSource(), /TURNSTILE_SECRET_KEY=\n$/);
  assert.equal(localFunctionEnvironmentSource([['A', '1'], ['B', '2']]), 'A=1\nB=2\n');
  assert.ok(Object.isFrozen(LOCAL_FUNCTION_ENV));
});

test('parses reset mode and rejects unknown startup options', () => {
  assert.deepEqual({ ...localDevelopmentMode() }, { resetDatabase: false });
  assert.deepEqual({ ...localDevelopmentMode(['--reset']) }, { resetDatabase: true });
  assert.throws(() => localDevelopmentMode(['--unknown']), /Unknown local development option: --unknown/);
});

test('starts only required Supabase services and supports reusable and reset flows', () => {
  const startArguments = localSupabaseStartArguments();
  assert.deepEqual([...startArguments], [
    'start',
    '-x',
    'studio,imgproxy,realtime,storage-api,postgres-meta,logflare,vector,supavisor',
  ]);
  assert.ok(Object.isFrozen(startArguments));

  assert.deepEqual(localStartupPlan({ resetDatabase: false, stackRunning: true }), []);
  assert.deepEqual(localStartupPlan({ resetDatabase: false, stackRunning: false }).map((step) => ({
    command: step.command,
    args: [...step.args],
    allowFailure: step.allowFailure,
  })), [{ command: 'supabase', args: [...startArguments], allowFailure: false }]);
  assert.deepEqual(localStartupPlan({ resetDatabase: true, stackRunning: true }).map((step) => ({
    command: step.command,
    args: [...step.args],
    allowFailure: step.allowFailure,
  })), [
    { command: 'supabase', args: ['stop', '--no-backup'], allowFailure: true },
    { command: 'supabase', args: [...startArguments], allowFailure: false },
    { command: 'supabase', args: ['db', 'reset', '--local'], allowFailure: false },
  ]);
});

test('exposes function, web and account readiness contracts', () => {
  assert.deepEqual([...localFunctionServeArguments()], ['functions', 'serve', '--env-file', LOCAL_FUNCTION_ENV_PATH]);
  assert.equal(localFunctionHealthUrl(), 'http://127.0.0.1:54321/functions/v1/game-api');
  assert.equal(localWebHealthUrl(), 'http://127.0.0.1:3000/config.js');
  assert.equal(localAccountUrl(), 'http://127.0.0.1:3000/cuenta.html');
});
