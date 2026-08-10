import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import { main as waitForLocalPostgrest } from './wait-for-postgrest-local.mjs';

const gameEndpoint = process.env.SUPABASE_FUNCTION_URL
  ?? 'http://127.0.0.1:54321/functions/v1/game-api';
const playerContextEndpoint = gameEndpoint.replace(/\/game-api$/, '/player-context');
const leagueEndpoint = gameEndpoint.replace(/\/game-api$/, '/league-api');
const origin = 'http://127.0.0.1:3000';
const privateHeaders = {
  'x-account-token': 'a'.repeat(64),
  'x-device-id': 'security-device-106-0001',
};

async function request(url, body, headers = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin,
      ...headers,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  try {
    return { response, payload: text ? JSON.parse(text) : {} };
  } catch {
    throw new Error(`Expected JSON from ${url}, received: ${text.slice(0, 300)}`);
  }
}

function localSupabaseEnvironment() {
  const result = spawnSync('supabase', ['status', '-o', 'env'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || 'supabase status failed');
  const environment = {};
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    environment[match[1]] = match[2].replace(/^"|"$/g, '');
  }
  assert.ok(environment.API_URL, 'Local Supabase API_URL is required');
  assert.ok(environment.SERVICE_ROLE_KEY, 'Local Supabase SERVICE_ROLE_KEY is required');
  assert.ok(environment.ANON_KEY, 'Local Supabase ANON_KEY is required');
  return environment;
}

async function serviceRpc(environment, name, parameters) {
  const result = await request(`${environment.API_URL}/rest/v1/rpc/${name}`, parameters, {
    apikey: environment.SERVICE_ROLE_KEY,
    authorization: `Bearer ${environment.SERVICE_ROLE_KEY}`,
  });
  assert.equal(result.response.status, 200, JSON.stringify(result.payload));
  return result.payload;
}

function log(message) {
  process.stdout.write(`✓ ${message}\n`);
}

await waitForLocalPostgrest();

for (const [nick, expectedAvailability] of [
  ['..', 'invalid-too_short'],
  ['../..', 'invalid-invalid_characters'],
  ['admin', 'invalid-reserved'],
  ['pedofilo', 'invalid-offensive'],
]) {
  const result = await request(playerContextEndpoint, { action: 'player-context', nick });
  assert.equal(result.response.status, 200, JSON.stringify(result.payload));
  assert.equal(result.payload.availability, expectedAvailability);
  assert.equal(result.payload.profile, null);
  assert.deepEqual(result.payload.leagues, []);
}
log('Debounced player context rejects malformed, reserved and offensive nicknames');

const sqlNickname = "x' OR 1=1; DROP TABLE game_players; --";
const writeAttempt = await request(gameEndpoint, {
  action: 'access-status',
  nick: sqlNickname,
}, privateHeaders);
assert.equal(writeAttempt.response.status, 400, JSON.stringify(writeAttempt.payload));
assert.match(String(writeAttempt.payload.code), /^nick_/);
log('SQL-like nickname payload is rejected before a write or CAPTCHA boundary');

const shortSqlNickname = "x' OR 1=1--";
const profileProbe = await request(gameEndpoint, { action: 'profile', nick: shortSqlNickname });
assert.equal(profileProbe.response.status, 400, JSON.stringify(profileProbe.payload));
assert.equal(profileProbe.payload.code, 'nick_invalid_characters');
log('Read-only profile lookup rejects malformed nickname input before the database boundary');

const searchPayload = "%' OR 1=1; DROP TABLE game_leagues; --";
const leagueSearch = await request(leagueEndpoint, {
  action: 'list-leagues',
  search: searchPayload,
  visibility: 'all',
});
assert.equal(leagueSearch.response.status, 400, JSON.stringify(leagueSearch.payload));
assert.equal(leagueSearch.payload.code, 'invalid_league_search');
log('League search rejects SQL-like text before the database boundary');

const leagueWrite = await request(leagueEndpoint, {
  action: 'create-league',
  nick: sqlNickname,
  name: 'Security test',
  visibility: 'private',
  durationDays: 3,
  maxParticipants: 10,
}, privateHeaders);
assert.equal(leagueWrite.response.status, 400, JSON.stringify(leagueWrite.payload));
log('League mutation rejects an invalid nickname before authorization or persistence');

const local = localSupabaseEnvironment();
const ipA = '1'.repeat(64);
const deviceA = '2'.repeat(64);
const deviceB = '3'.repeat(64);
const ipB = '4'.repeat(64);

const firstFailure = await serviceRpc(local, 'zadmin_login_gate', {
  p_ip_hash: ipA,
  p_device_hash: deviceA,
  p_credentials_valid: false,
  p_at: '2026-08-10T10:00:00Z',
});
assert.equal(firstFailure.blocked, false);
assert.equal(firstFailure.attemptsRemaining, 2);

const secondFailure = await serviceRpc(local, 'zadmin_login_gate', {
  p_ip_hash: ipA,
  p_device_hash: deviceA,
  p_credentials_valid: false,
  p_at: '2026-08-10T10:10:00Z',
});
assert.equal(secondFailure.blocked, false);
assert.equal(secondFailure.attemptsRemaining, 1);

const thirdFailure = await serviceRpc(local, 'zadmin_login_gate', {
  p_ip_hash: ipA,
  p_device_hash: deviceA,
  p_credentials_valid: false,
  p_at: '2026-08-10T10:20:00Z',
});
assert.equal(thirdFailure.blocked, true);
assert.equal(thirdFailure.attemptsRemaining, 0);
assert.equal(thirdFailure.retryAfterSeconds, 2_400);

const validWhileBlocked = await serviceRpc(local, 'zadmin_login_gate', {
  p_ip_hash: ipA,
  p_device_hash: deviceA,
  p_credentials_valid: true,
  p_at: '2026-08-10T10:30:00Z',
});
assert.equal(validWhileBlocked.authenticated, false);
assert.equal(validWhileBlocked.blocked, true);
assert.equal(validWhileBlocked.retryAfterSeconds, 1_800);

const sameIpDifferentDevice = await serviceRpc(local, 'zadmin_login_gate', {
  p_ip_hash: ipA,
  p_device_hash: deviceB,
  p_credentials_valid: true,
  p_at: '2026-08-10T10:30:00Z',
});
assert.equal(sameIpDifferentDevice.blocked, true);

const differentIpSameDevice = await serviceRpc(local, 'zadmin_login_gate', {
  p_ip_hash: ipB,
  p_device_hash: deviceA,
  p_credentials_valid: true,
  p_at: '2026-08-10T10:30:00Z',
});
assert.equal(differentIpSameDevice.blocked, true);

const exactWindowExpiry = await serviceRpc(local, 'zadmin_login_gate', {
  p_ip_hash: ipA,
  p_device_hash: deviceA,
  p_credentials_valid: true,
  p_at: '2026-08-10T11:00:00Z',
});
assert.equal(exactWindowExpiry.blocked, false);
assert.equal(exactWindowExpiry.authenticated, true);
assert.equal(exactWindowExpiry.attemptsRemaining, 1);
log('Zadmin login gate enforces three rolling failures independently by IP and device and expires exactly at the one-hour boundary');

const invalidSubject = await serviceRpc(local, 'zadmin_login_gate', {
  p_ip_hash: 'invalid',
  p_device_hash: deviceA,
  p_credentials_valid: false,
  p_at: '2026-08-10T11:00:00Z',
});
assert.equal(invalidSubject.error, 'invalid_subject');

const concurrentIp = '5'.repeat(64);
const concurrentDevice = '6'.repeat(64);
const concurrentResults = await Promise.all(
  Array.from({ length: 4 }, (_, index) => serviceRpc(local, 'zadmin_login_gate', {
    p_ip_hash: concurrentIp,
    p_device_hash: concurrentDevice,
    p_credentials_valid: false,
    p_at: `2026-08-10T12:0${index}:00Z`,
  })),
);
assert.equal(concurrentResults.filter((result) => result.blocked === true).length, 2);
const concurrentValid = await serviceRpc(local, 'zadmin_login_gate', {
  p_ip_hash: concurrentIp,
  p_device_hash: concurrentDevice,
  p_credentials_valid: true,
  p_at: '2026-08-10T12:04:00Z',
});
assert.equal(concurrentValid.blocked, true);
assert.equal(concurrentValid.authenticated, false);
log('Concurrent zadmin login failures serialize through the database gate and cannot race past the three-attempt limit');

const sessionTokenHash = '7'.repeat(64);
const sessionIp = '8'.repeat(64);
const sessionDevice = '9'.repeat(64);
const session = await serviceRpc(local, 'zadmin_create_session', {
  p_token_hash: sessionTokenHash,
  p_ip_hash: sessionIp,
  p_device_hash: sessionDevice,
  p_at: '2026-08-10T13:00:00Z',
});
assert.match(String(session.sessionId), /^[0-9a-f-]{36}$/i);
assert.equal(session.expiresAt, '2026-08-10T13:30:00+00:00');

const validSession = await serviceRpc(local, 'zadmin_validate_session', {
  p_token_hash: sessionTokenHash,
  p_ip_hash: sessionIp,
  p_device_hash: sessionDevice,
  p_at: '2026-08-10T13:10:00Z',
});
assert.equal(validSession.valid, true);
assert.equal(validSession.sessionId, session.sessionId);

const wrongIpSession = await serviceRpc(local, 'zadmin_validate_session', {
  p_token_hash: sessionTokenHash,
  p_ip_hash: 'a'.repeat(64),
  p_device_hash: sessionDevice,
  p_at: '2026-08-10T13:10:00Z',
});
assert.equal(wrongIpSession.valid, false);

const wrongDeviceSession = await serviceRpc(local, 'zadmin_validate_session', {
  p_token_hash: sessionTokenHash,
  p_ip_hash: sessionIp,
  p_device_hash: 'b'.repeat(64),
  p_at: '2026-08-10T13:10:00Z',
});
assert.equal(wrongDeviceSession.valid, false);

const expiredSession = await serviceRpc(local, 'zadmin_validate_session', {
  p_token_hash: sessionTokenHash,
  p_ip_hash: sessionIp,
  p_device_hash: sessionDevice,
  p_at: '2026-08-10T13:30:00Z',
});
assert.equal(expiredSession.valid, false);

const revocableTokenHash = 'c'.repeat(64);
const revocableSession = await serviceRpc(local, 'zadmin_create_session', {
  p_token_hash: revocableTokenHash,
  p_ip_hash: sessionIp,
  p_device_hash: sessionDevice,
  p_at: '2026-08-10T14:00:00Z',
});
assert.equal(await serviceRpc(local, 'zadmin_revoke_session', {
  p_session_id: revocableSession.sessionId,
  p_at: '2026-08-10T14:05:00Z',
}), true);
const revokedSession = await serviceRpc(local, 'zadmin_validate_session', {
  p_token_hash: revocableTokenHash,
  p_ip_hash: sessionIp,
  p_device_hash: sessionDevice,
  p_at: '2026-08-10T14:06:00Z',
});
assert.equal(revokedSession.valid, false);
log('Zadmin sessions are server-side, expire at 30 minutes, bind to the login IP/device fingerprints and reject revoked sessions');

const anonSessionProbe = await request(`${local.API_URL}/rest/v1/rpc/zadmin_validate_session`, {
  p_token_hash: sessionTokenHash,
  p_ip_hash: sessionIp,
  p_device_hash: sessionDevice,
  p_at: '2026-08-10T13:10:00Z',
}, {
  apikey: local.ANON_KEY,
  authorization: `Bearer ${local.ANON_KEY}`,
});
assert.ok([401, 403, 404].includes(anonSessionProbe.response.status), JSON.stringify(anonSessionProbe.payload));
log('Anonymous browser credentials cannot invoke the privileged zadmin session RPC');

const statsAfter = await request(gameEndpoint, { action: 'stats' });
assert.equal(statsAfter.response.status, 200, JSON.stringify(statsAfter.payload));
const leaguesAfter = await request(leagueEndpoint, {
  action: 'list-leagues',
  search: '',
  visibility: 'all',
});
assert.equal(leaguesAfter.response.status, 200, JSON.stringify(leaguesAfter.payload));
assert.ok(Array.isArray(leaguesAfter.payload));
log('Database and public APIs remain healthy after every injection and admin-rate probe');
