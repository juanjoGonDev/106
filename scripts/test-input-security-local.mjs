import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
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
  assert.ok(environment.DB_URL || environment.POSTGRES_URL, 'Local Supabase database URL is required');
  environment.DATABASE_URL = environment.DB_URL || environment.POSTGRES_URL;
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

function runPsql(environment, sql) {
  const result = spawnSync('psql', [
    environment.DATABASE_URL,
    '--no-psqlrc',
    '--tuples-only',
    '--no-align',
    '--set',
    'ON_ERROR_STOP=1',
    '--command',
    sql,
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout || 'psql failed');
  return result.stdout.trim();
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function jsonPsql(environment, expression) {
  const value = runPsql(environment, `select (${expression})::text;`).split(/\r?\n/).filter(Boolean).at(-1) ?? '';
  return JSON.parse(value);
}

function scalarPsql(environment, expression) {
  return runPsql(environment, `select (${expression})::text;`).split(/\r?\n/).filter(Boolean).at(-1) ?? '';
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
assert.equal(session.expiresAt, '2026-08-11T01:00:00+00:00');

const validSession = await serviceRpc(local, 'zadmin_validate_session', {
  p_token_hash: sessionTokenHash,
  p_ip_hash: sessionIp,
  p_device_hash: sessionDevice,
  p_at: '2026-08-10T13:10:00Z',
});
assert.equal(validSession.valid, true);
assert.equal(validSession.sessionId, session.sessionId);
assert.equal(validSession.expiresAt, '2026-08-11T01:10:00+00:00');

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

const originalExpirySurvives = await serviceRpc(local, 'zadmin_validate_session', {
  p_token_hash: sessionTokenHash,
  p_ip_hash: sessionIp,
  p_device_hash: sessionDevice,
  p_at: '2026-08-11T01:00:00Z',
});
assert.equal(originalExpirySurvives.valid, true);
assert.equal(originalExpirySurvives.expiresAt, '2026-08-11T13:00:00+00:00');

const renewedIdleExpiry = await serviceRpc(local, 'zadmin_validate_session', {
  p_token_hash: sessionTokenHash,
  p_ip_hash: sessionIp,
  p_device_hash: sessionDevice,
  p_at: '2026-08-11T13:00:00Z',
});
assert.equal(renewedIdleExpiry.valid, false);

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
log('Zadmin sessions remain memory-token bound to IP/device, renew while active and expire after the 12-hour idle window or explicit revocation');

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

const scriptedBurst = await serviceRpc(local, 'game_attempt_integrity_decision', {
  p_evidence: {
    anchorNearPerfect: true,
    sameDeviceNearPerfect: 3,
    sessionAttempts2h: 3,
    sessionNearPerfect2h: 3,
    sessionVeryNear2h: 2,
  },
});
assert.equal(scriptedBurst.riskScore, 60);
assert.equal(scriptedBurst.status, 'watch');
assert.equal(scriptedBurst.malicious, false);
assert.deepEqual(new Set(scriptedBurst.reasons), new Set([
  'near_perfect_frequency',
  'two_hour_near_perfect_frequency',
  'two_hour_extreme_precision_burst',
  'two_hour_all_near_perfect',
]));

const precisionOnlyLargeSample = await serviceRpc(local, 'game_attempt_integrity_decision', {
  p_evidence: {
    anchorNearPerfect: true,
    sameDeviceNearPerfect: 8,
    sessionAttempts2h: 8,
    sessionNearPerfect2h: 8,
    sessionVeryNear2h: 8,
  },
});
assert.equal(precisionOnlyLargeSample.riskScore, 75);
assert.equal(precisionOnlyLargeSample.status, 'watch');
assert.equal(precisionOnlyLargeSample.malicious, false);
log('Extreme 1/2/3 ms-style bursts rise to review priority while timing evidence alone still cannot convict or auto-exclude');

const reviewSessionTokenHash = 'd'.repeat(64);
const reviewSession = await serviceRpc(local, 'zadmin_create_session', {
  p_token_hash: reviewSessionTokenHash,
  p_ip_hash: 'e'.repeat(64),
  p_device_hash: 'f'.repeat(64),
  p_at: '2026-08-10T15:00:00Z',
});
const suffix = randomUUID().replaceAll('-', '').slice(0, 8);
const reviewNick = `Review${suffix}`;
const reviewNickKey = reviewNick.toLocaleLowerCase('es');
const reviewDevice = '1a'.repeat(32);
const reviewIp = '2b'.repeat(32);
const reviewAccountToken = '3c'.repeat(32);
const challengeId = randomUUID();
const attemptId = randomUUID();
const reviewAt = '2026-08-10T15:10:00Z';

runPsql(local, `
  select public.ensure_game_account_player(
    ${sqlLiteral(reviewNick)},
    ${sqlLiteral(reviewNickKey)},
    ${sqlLiteral(reviewDevice)},
    ${sqlLiteral(reviewIp)},
    ${sqlLiteral(reviewAccountToken)},
    null
  );
  insert into public.game_challenges(
    id, nick, nick_key, team, device_hash, ip_hash,
    started_at, expires_at, consumed_at, quota_day
  ) values (
    ${sqlLiteral(challengeId)}::uuid,
    ${sqlLiteral(reviewNick)},
    ${sqlLiteral(reviewNickKey)},
    'spain',
    ${sqlLiteral(reviewDevice)},
    ${sqlLiteral(reviewIp)},
    ${sqlLiteral(reviewAt)}::timestamptz,
    ${sqlLiteral(reviewAt)}::timestamptz + interval '30 seconds',
    ${sqlLiteral(reviewAt)}::timestamptz,
    public.game_server_day(${sqlLiteral(reviewAt)}::timestamptz)
  );
  insert into public.game_attempts(
    id, challenge_id, nick, nick_key, team, device_hash, ip_hash,
    client_elapsed_ms, server_elapsed_ms, difference_ms, verified,
    verification_reasons, client_signals, quota_day, created_at
  ) values (
    ${sqlLiteral(attemptId)}::uuid,
    ${sqlLiteral(challengeId)}::uuid,
    ${sqlLiteral(reviewNick)},
    ${sqlLiteral(reviewNickKey)},
    'spain',
    ${sqlLiteral(reviewDevice)},
    ${sqlLiteral(reviewIp)},
    10603,
    10603,
    3,
    true,
    '{}'::text[],
    '{}'::jsonb,
    public.game_server_day(${sqlLiteral(reviewAt)}::timestamptz),
    ${sqlLiteral(reviewAt)}::timestamptz
  );
`);
await serviceRpc(local, 'reassess_game_integrity_cluster', { p_anchor_attempt_id: attemptId });
const rawBeforeReview = jsonPsql(local, `(
  select jsonb_build_object(
    'difference', difference_ms,
    'clientElapsed', client_elapsed_ms,
    'serverElapsed', server_elapsed_ms,
    'signals', client_signals,
    'verified', verified
  )
  from public.game_attempts where id = ${sqlLiteral(attemptId)}::uuid
)`);
assert.equal(rawBeforeReview.verified, true);

const invalidated = await serviceRpc(local, 'zadmin_set_attempt_review', {
  p_attempt_id: attemptId,
  p_invalidated: true,
  p_reason: 'Script confirmado en revisión manual.',
  p_actor_session_id: reviewSession.sessionId,
  p_at: '2026-08-10T15:20:00Z',
});
assert.equal(invalidated.invalidated, true);
assert.equal(invalidated.effectiveVerified, false);

const rawAfterInvalidation = jsonPsql(local, `(
  select jsonb_build_object(
    'difference', difference_ms,
    'clientElapsed', client_elapsed_ms,
    'serverElapsed', server_elapsed_ms,
    'signals', client_signals,
    'verified', verified
  )
  from public.game_attempts where id = ${sqlLiteral(attemptId)}::uuid
)`);
assert.deepEqual(
  { ...rawAfterInvalidation, verified: rawBeforeReview.verified },
  rawBeforeReview,
  'Manual invalidation must preserve raw timing and telemetry fields',
);
assert.equal(rawAfterInvalidation.verified, false);

runPsql(local, `update public.game_attempts set verified = true where id = ${sqlLiteral(attemptId)}::uuid;`);
assert.equal(scalarPsql(local, `(select verified from public.game_attempts where id = ${sqlLiteral(attemptId)}::uuid)`), 'false');
assert.equal(
  jsonPsql(local, `public.game_admin_attempt_manual_state(${sqlLiteral(attemptId)}::uuid)`).invalidated,
  true,
);

const restored = await serviceRpc(local, 'zadmin_set_attempt_review', {
  p_attempt_id: attemptId,
  p_invalidated: false,
  p_reason: 'Anulación retirada tras nueva revisión.',
  p_actor_session_id: reviewSession.sessionId,
  p_at: '2026-08-10T15:25:00Z',
});
assert.equal(restored.invalidated, false);
assert.equal(restored.effectiveVerified, true);
assert.equal(
  scalarPsql(local, `(select count(*) from public.game_admin_attempt_actions where attempt_id = ${sqlLiteral(attemptId)}::uuid)`),
  '2',
);
assert.equal(
  scalarPsql(local, `(select count(*) from public.game_admin_audit_events where target_scope = 'attempt' and target_key = ${sqlLiteral(attemptId)})`),
  '2',
);
log('Individual attempt invalidation is append-only, preserves raw evidence, resists rebuild-style re-enable, reconciles derived state and restores through canonical reassessment');

const anonAttemptReviewProbe = await request(`${local.API_URL}/rest/v1/rpc/zadmin_set_attempt_review`, {
  p_attempt_id: attemptId,
  p_invalidated: true,
  p_reason: 'unauthorized',
  p_actor_session_id: reviewSession.sessionId,
}, {
  apikey: local.ANON_KEY,
  authorization: `Bearer ${local.ANON_KEY}`,
});
assert.ok([401, 403, 404].includes(anonAttemptReviewProbe.response.status), JSON.stringify(anonAttemptReviewProbe.payload));
log('Anonymous browser credentials cannot invoke individual zadmin attempt review RPCs');

const statsAfter = await request(gameEndpoint, { action: 'stats' });
assert.equal(statsAfter.response.status, 200, JSON.stringify(statsAfter.payload));
const leaguesAfter = await request(leagueEndpoint, {
  action: 'list-leagues',
  search: '',
  visibility: 'all',
});
assert.equal(leaguesAfter.response.status, 200, JSON.stringify(leaguesAfter.payload));
assert.ok(Array.isArray(leaguesAfter.payload));
log('Database and public APIs remain healthy after every injection and admin security probe');
