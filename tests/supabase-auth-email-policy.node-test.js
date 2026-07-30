import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import {
  SUPABASE_AUTH_EMAIL_POLICY,
  parseSupabaseAuthEmailPolicy,
  readSupabaseAuthEmailPolicy,
} from '../scripts/supabase-auth-email-policy.mjs';

test('reads the canonical eight-digit one-hour policy from Supabase config', () => {
  assert.deepEqual(SUPABASE_AUTH_EMAIL_POLICY, {
    otpLength: 8,
    otpExpirySeconds: 3600,
  });
  assert.ok(Object.isFrozen(SUPABASE_AUTH_EMAIL_POLICY));
  assert.deepEqual(readSupabaseAuthEmailPolicy(), SUPABASE_AUTH_EMAIL_POLICY);
});

test('parses only auth.email integer settings with comments and CRLF safely', () => {
  const policy = parseSupabaseAuthEmailPolicy([
    '# global comment',
    '',
    '[auth.email',
    '[auth]',
    'otp_length = 6',
    '[auth.email] # managed policy',
    'enable_signup = true',
    'invalid setting',
    'bad-key = 1',
    'otp_length = 10 # upper supported boundary',
    'otp_expiry = 90',
    '[auth.email.template.confirmation]',
    'otp_length = 7',
  ].join('\r\n'));

  assert.deepEqual(policy, { otpLength: 10, otpExpirySeconds: 90 });
  assert.ok(Object.isFrozen(policy));
});

test('reads an explicitly supplied config file', () => {
  const directory = mkdtempSync(join(tmpdir(), 'minuto106-auth-policy-'));
  const path = join(directory, 'config.toml');
  try {
    writeFileSync(path, '[auth.email]\notp_length = 7\notp_expiry = 120\n', 'utf8');
    assert.deepEqual(readSupabaseAuthEmailPolicy(pathToFileURL(path)), {
      otpLength: 7,
      otpExpirySeconds: 120,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('fails closed for absent, malformed and unsupported OTP policy values', () => {
  for (const source of [
    null,
    '[auth]\notp_length = 8\notp_expiry = 3600',
    '[auth.email]\notp_expiry = 3600',
    '[auth.email]\notp_length = 5\notp_expiry = 3600',
    '[auth.email]\notp_length = 11\notp_expiry = 3600',
    '[auth.email]\notp_length = "8"\notp_expiry = 3600',
  ]) {
    assert.throws(() => parseSupabaseAuthEmailPolicy(source), /otp_length.*6 to 10/u);
  }

  for (const source of [
    '[auth.email]\notp_length = 8',
    '[auth.email]\notp_length = 8\notp_expiry = 0',
    '[auth.email]\notp_length = 8\notp_expiry = 1.5',
    '[auth.email]\notp_length = 8\notp_expiry = "3600"',
  ]) {
    assert.throws(() => parseSupabaseAuthEmailPolicy(source), /otp_expiry.*positive integer/u);
  }
});
