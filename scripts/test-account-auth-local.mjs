import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const origin = 'http://127.0.0.1:3000';
const hashPepper = 'ci-local-only-pepper-106-do-not-use-in-production';

function readLocalEnvironment() {
  const result = spawnSync('supabase', ['status', '-o', 'env'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`supabase status failed: ${result.stderr || result.stdout}`);

  const values = {};
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(?:"([^"]*)"|'([^']*)'|(.*))$/);
    if (match) values[match[1]] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  const apiUrl = values.API_URL || 'http://127.0.0.1:54321';
  const anonKey = values.ANON_KEY;
  const serviceRoleKey = values.SERVICE_ROLE_KEY;
  const databaseUrl = values.DB_URL || values.POSTGRES_URL;
  if (!anonKey || !serviceRoleKey || !databaseUrl) throw new Error('Local Supabase auth environment is incomplete.');
  return { apiUrl, anonKey, serviceRoleKey, databaseUrl };
}

function psql(databaseUrl, sql) {
  const result = spawnSync('psql', [
    databaseUrl,
    '--no-psqlrc',
    '--tuples-only',
    '--no-align',
    '--set',
    'ON_ERROR_STOP=1',
    '--command',
    sql,
  ], { cwd: process.cwd(), encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`psql failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function accountHash(token) {
  return createHash('sha256').update(`${hashPepper}:account:${token}`).digest('hex');
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, {
    method: options.method ?? 'POST',
    headers: {
      origin,
      'content-type': 'application/json',
      ...options.headers,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Expected JSON from ${url}, received ${text.slice(0, 300)}`);
  }
  return { response, body };
}

async function waitForAccountAuth(endpoint) {
  let lastError;
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    try {
      const result = await jsonRequest(endpoint, { body: { action: 'session' }, timeoutMs: 3_000 });
      if (result.response.status === 401) return;
      lastError = new Error(`Unexpected status ${result.response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(1_000);
  }
  throw new Error(`account-auth did not become ready: ${lastError?.message ?? 'unknown error'}`);
}

async function createAuthUser(environment, email, password) {
  const created = await jsonRequest(`${environment.apiUrl}/auth/v1/admin/users`, {
    headers: {
      apikey: environment.serviceRoleKey,
      authorization: `Bearer ${environment.serviceRoleKey}`,
    },
    body: { email, password, email_confirm: true },
  });
  assert.equal(created.response.status, 200, JSON.stringify(created.body));
  return created.body;
}

async function signIn(environment, email, password) {
  const result = await jsonRequest(`${environment.apiUrl}/auth/v1/token?grant_type=password`, {
    headers: { apikey: environment.anonKey },
    body: { email, password },
  });
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  assert.ok(result.body.access_token);
  return result.body;
}

async function accountAuth(environment, jwt, action, body = {}, accountToken = '', deviceId = randomUUID()) {
  const headers = {
    apikey: environment.anonKey,
    authorization: `Bearer ${jwt}`,
    'x-device-id': `auth-device-${deviceId}`.slice(0, 80),
  };
  if (accountToken) headers['x-account-token'] = accountToken;
  return jsonRequest(`${environment.apiUrl}/functions/v1/account-auth`, {
    headers,
    body: { action, ...body },
  });
}

async function createAnonymousPlayer(environment, token, nick) {
  const result = await jsonRequest(`${environment.apiUrl}/functions/v1/game-api`, {
    headers: {
      'x-account-token': token,
      'x-device-id': `player-device-${randomUUID()}`,
    },
    body: { action: 'link-account-player', nick },
  });
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.authorized, true);
}

async function accountPlayers(environment, token) {
  return jsonRequest(`${environment.apiUrl}/functions/v1/game-api`, {
    headers: { 'x-account-token': token },
    body: { action: 'account-players' },
  });
}

function accountId(databaseUrl, token) {
  return psql(databaseUrl, `select public.resolve_game_account_token(${sqlLiteral(accountHash(token))});`);
}

function seedCompletedReferral(databaseUrl, referrerNick, referredNick, suffix) {
  psql(databaseUrl, `
    insert into public.game_referrals(
      referral_code, referrer_nick_key, referred_nick_key,
      referred_device_hash, referred_ip_hash, completed_at
    ) values (
      gen_random_uuid(), ${sqlLiteral(referrerNick)}, ${sqlLiteral(referredNick)},
      ${sqlLiteral(`referral-device-${suffix}`)}, ${sqlLiteral(`referral-ip-${suffix}`)}, clock_timestamp()
    );
    update public.game_player_bonus
    set bonus_attempts = bonus_attempts + 1,
        updated_at = clock_timestamp()
    where nick_key = ${sqlLiteral(referrerNick)};
    insert into public.game_player_achievements(
      nick_key, achievement_code, achievement_kind, title, description,
      points, achieved_on, metadata
    ) values (
      ${sqlLiteral(referrerNick)}, ${sqlLiteral(`referral_total_1_${suffix}`)}, 'referral_total',
      'Primer fichaje', 'Conseguiste un referido válido.', 15,
      (clock_timestamp() at time zone 'Europe/Madrid')::date,
      jsonb_build_object('threshold', 1)
    );
  `);
}

const environment = readLocalEnvironment();
const accountAuthEndpoint = `${environment.apiUrl}/functions/v1/account-auth`;
await waitForAccountAuth(accountAuthEndpoint);

const noSession = await jsonRequest(accountAuthEndpoint, {
  headers: { apikey: environment.anonKey, 'x-device-id': 'auth-device-no-session' },
  body: { action: 'session' },
});
assert.equal(noSession.response.status, 401);
assert.equal(noSession.body.code, 'auth_required');

const invalidSession = await accountAuth(environment, 'not-a-valid-jwt', 'session');
assert.equal(invalidSession.response.status, 401);
assert.equal(invalidSession.body.code, 'invalid_session');
process.stdout.write('✓ account-auth rejects missing and invalid user JWTs\n');

const suffix = Date.now().toString(36);
const password = 'LocalAuthPassword123!';
const firstEmail = `first-${suffix}@example.com`;
const firstUser = await createAuthUser(environment, firstEmail, password);
const firstSession = await signIn(environment, firstEmail, password);
const sessionStatus = await accountAuth(environment, firstSession.access_token, 'session');
assert.equal(sessionStatus.response.status, 200);
assert.deepEqual(sessionStatus.body.auth, { provider: 'email', email: firstEmail, emailVerified: true });

const newAccount = await accountAuth(environment, firstSession.access_token, 'sync-account');
assert.equal(newAccount.response.status, 200, JSON.stringify(newAccount.body));
assert.equal(newAccount.body.created, true);
assert.match(newAccount.body.accountToken, /^[a-f0-9]{64}$/);
const firstToken = newAccount.body.accountToken;
const firstAccount = accountId(environment.databaseUrl, firstToken);
assert.match(firstAccount, /^[0-9a-f-]{36}$/);
assert.equal(psql(environment.databaseUrl, `select email_normalized from public.game_auth_identities where auth_user_id = ${sqlLiteral(firstUser.id)}::uuid;`), firstEmail);
process.stdout.write('✓ a confirmed email identity creates a recoverable game account without exposing email publicly\n');

const ownerToken = randomBytes(32).toString('hex');
const ownerNick = `owner${suffix}`.slice(0, 24);
await createAnonymousPlayer(environment, ownerToken, ownerNick);
const secondEmail = `second-${suffix}@example.com`;
await createAuthUser(environment, secondEmail, password);
const secondSession = await signIn(environment, secondEmail, password);
const linked = await accountAuth(environment, secondSession.access_token, 'sync-account', {}, ownerToken);
assert.equal(linked.response.status, 200, JSON.stringify(linked.body));
assert.equal(linked.body.linked, true);
assert.equal(linked.body.issueToken, false);

const recovered = await accountAuth(environment, secondSession.access_token, 'sync-account', {}, '', randomUUID());
assert.equal(recovered.response.status, 200, JSON.stringify(recovered.body));
assert.equal(recovered.body.recovered, true);
assert.match(recovered.body.accountToken, /^[a-f0-9]{64}$/);
const recoveredPlayers = await accountPlayers(environment, recovered.body.accountToken);
assert.equal(recoveredPlayers.response.status, 200);
assert.ok(recoveredPlayers.body.players.some((player) => player.nick === ownerNick));
process.stdout.write('✓ OAuth/email identity linking preserves the anonymous key and recovers all nicks on a clean device\n');

const targetToken = randomBytes(32).toString('hex');
const sourceToken = randomBytes(32).toString('hex');
const targetNick = `target${suffix}`.slice(0, 24);
const sourceNick = `source${suffix}`.slice(0, 24);
await createAnonymousPlayer(environment, targetToken, targetNick);
await createAnonymousPlayer(environment, sourceToken, sourceNick);
const mergeEmail = `merge-${suffix}@example.com`;
await createAuthUser(environment, mergeEmail, password);
const mergeSession = await signIn(environment, mergeEmail, password);
const targetLink = await accountAuth(environment, mergeSession.access_token, 'sync-account', {}, targetToken);
assert.equal(targetLink.response.status, 200, JSON.stringify(targetLink.body));
seedCompletedReferral(environment.databaseUrl, sourceNick, targetNick, `${suffix}-one`);

const prepared = await accountAuth(environment, mergeSession.access_token, 'sync-account', {}, sourceToken);
assert.equal(prepared.response.status, 200, JSON.stringify(prepared.body));
assert.equal(prepared.body.mergeRequired, true);
assert.equal(prepared.body.impact.referrals.length, 1);
assert.equal(prepared.body.impact.bonusAdjustments[0].attempts, 1);
assert.ok(prepared.body.impact.achievements.some((achievement) => achievement.kind === 'referral_total'));

const confirmed = await accountAuth(environment, mergeSession.access_token, 'confirm-merge', {
  proposalId: prepared.body.proposalId,
  fingerprint: prepared.body.fingerprint,
}, sourceToken);
assert.equal(confirmed.response.status, 200, JSON.stringify(confirmed.body));
assert.equal(confirmed.body.merged, true);

for (const token of [sourceToken, targetToken]) {
  const players = await accountPlayers(environment, token);
  assert.equal(players.response.status, 200, JSON.stringify(players.body));
  assert.deepEqual(new Set(players.body.players.map((player) => player.nick)), new Set([sourceNick, targetNick]));
}
assert.equal(psql(environment.databaseUrl, `select identity_invalidated_at is not null from public.game_referrals where referrer_nick_key = ${sqlLiteral(sourceNick)} and referred_nick_key = ${sqlLiteral(targetNick)};`), 't');
assert.equal(psql(environment.databaseUrl, `select bonus_attempts from public.game_player_bonus where nick_key = ${sqlLiteral(sourceNick)};`), '0');
assert.equal(psql(environment.databaseUrl, `select count(*) from public.game_player_achievements where nick_key = ${sqlLiteral(sourceNick)} and achievement_kind = 'referral_total';`), '0');
assert.equal(psql(environment.databaseUrl, `select public.resolve_game_account_id(${sqlLiteral(accountId(environment.databaseUrl, sourceToken))}::uuid) = public.resolve_game_account_id(${sqlLiteral(accountId(environment.databaseUrl, targetToken))}::uuid);`), 't');
process.stdout.write('✓ confirmed cross-account merge is atomic, keeps both keys and revokes self-referral rewards\n');

const staleTargetToken = randomBytes(32).toString('hex');
const staleSourceToken = randomBytes(32).toString('hex');
const staleTargetNick = `stalet${suffix}`.slice(0, 24);
const staleSourceNick = `stales${suffix}`.slice(0, 24);
await createAnonymousPlayer(environment, staleTargetToken, staleTargetNick);
await createAnonymousPlayer(environment, staleSourceToken, staleSourceNick);
const staleEmail = `stale-${suffix}@example.com`;
await createAuthUser(environment, staleEmail, password);
const staleSession = await signIn(environment, staleEmail, password);
await accountAuth(environment, staleSession.access_token, 'sync-account', {}, staleTargetToken);
seedCompletedReferral(environment.databaseUrl, staleSourceNick, staleTargetNick, `${suffix}-stale-a`);
const staleProposal = await accountAuth(environment, staleSession.access_token, 'sync-account', {}, staleSourceToken);
assert.equal(staleProposal.body.mergeRequired, true);
seedCompletedReferral(environment.databaseUrl, staleTargetNick, staleSourceNick, `${suffix}-stale-b`);
const staleConfirmation = await accountAuth(environment, staleSession.access_token, 'confirm-merge', {
  proposalId: staleProposal.body.proposalId,
  fingerprint: staleProposal.body.fingerprint,
}, staleSourceToken);
assert.equal(staleConfirmation.response.status, 409);
assert.equal(staleConfirmation.body.code, 'merge_proposal_stale');
assert.equal(accountId(environment.databaseUrl, staleSourceToken) === accountId(environment.databaseUrl, staleTargetToken), false);
process.stdout.write('✓ stale merge proposals are rejected after competitive data changes\n');

const cancelTargetToken = randomBytes(32).toString('hex');
const cancelSourceToken = randomBytes(32).toString('hex');
const cancelTargetNick = `cancelt${suffix}`.slice(0, 24);
const cancelSourceNick = `cancels${suffix}`.slice(0, 24);
await createAnonymousPlayer(environment, cancelTargetToken, cancelTargetNick);
await createAnonymousPlayer(environment, cancelSourceToken, cancelSourceNick);
const cancelEmail = `cancel-${suffix}@example.com`;
await createAuthUser(environment, cancelEmail, password);
const cancelSession = await signIn(environment, cancelEmail, password);
await accountAuth(environment, cancelSession.access_token, 'sync-account', {}, cancelTargetToken);
seedCompletedReferral(environment.databaseUrl, cancelSourceNick, cancelTargetNick, `${suffix}-cancel`);
const cancelProposal = await accountAuth(environment, cancelSession.access_token, 'sync-account', {}, cancelSourceToken);
const cancelled = await accountAuth(environment, cancelSession.access_token, 'cancel-merge', {
  proposalId: cancelProposal.body.proposalId,
}, cancelSourceToken);
assert.equal(cancelled.response.status, 200);
assert.equal(cancelled.body.cancelled, true);
const cancelledConfirmation = await accountAuth(environment, cancelSession.access_token, 'confirm-merge', {
  proposalId: cancelProposal.body.proposalId,
  fingerprint: cancelProposal.body.fingerprint,
}, cancelSourceToken);
assert.equal(cancelledConfirmation.response.status, 409);
assert.equal(cancelledConfirmation.body.code, 'merge_proposal_cancelled');
process.stdout.write('✓ cancelled merge proposals leave both accounts untouched\n');

for (const authorization of [environment.anonKey, firstSession.access_token]) {
  const directTable = await jsonRequest(`${environment.apiUrl}/rest/v1/game_accounts?select=id`, {
    method: 'GET',
    headers: { apikey: environment.anonKey, authorization: `Bearer ${authorization}` },
  });
  assert.notEqual(directTable.response.status, 200, 'Direct game_accounts access must be rejected.');

  const directRpc = await jsonRequest(`${environment.apiUrl}/rest/v1/rpc/prepare_game_auth_link`, {
    headers: { apikey: environment.anonKey, authorization: `Bearer ${authorization}` },
    body: {
      p_auth_user_id: randomUUID(),
      p_provider: 'email',
      p_email: null,
      p_email_verified: false,
      p_account_token_hash: null,
      p_new_token_hash: 'c'.repeat(64),
    },
  });
  assert.notEqual(directRpc.response.status, 200, 'Direct privileged RPC execution must be rejected.');
}
process.stdout.write('✓ real PostgREST probes reject anon and authenticated table/RPC access\n');
