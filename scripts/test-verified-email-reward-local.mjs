import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const origin = 'http://127.0.0.1:3000';

function localEnvironment() {
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
  const environment = {
    apiUrl: values.API_URL || 'http://127.0.0.1:54321',
    anonKey: values.ANON_KEY,
    serviceRoleKey: values.SERVICE_ROLE_KEY,
    databaseUrl: values.DB_URL || values.POSTGRES_URL,
  };
  if (!environment.anonKey || !environment.serviceRoleKey || !environment.databaseUrl) {
    throw new Error('Local Supabase environment is incomplete.');
  }
  return environment;
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
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

async function request(url, options = {}) {
  const response = await fetch(url, {
    method: options.method ?? 'POST',
    headers: {
      origin,
      'content-type': 'application/json',
      ...options.headers,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  return { response, body };
}

async function createAuthUser(environment, email, password, confirmed) {
  const result = await request(`${environment.apiUrl}/auth/v1/admin/users`, {
    headers: {
      apikey: environment.serviceRoleKey,
      authorization: `Bearer ${environment.serviceRoleKey}`,
    },
    body: { email, password, email_confirm: confirmed },
  });
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  return result.body;
}

async function signIn(environment, email, password) {
  const result = await request(`${environment.apiUrl}/auth/v1/token?grant_type=password`, {
    headers: { apikey: environment.anonKey },
    body: { email, password },
  });
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  return result.body.access_token;
}

async function linkNick(environment, accountToken, nick) {
  const result = await request(`${environment.apiUrl}/functions/v1/game-api`, {
    headers: {
      'x-account-token': accountToken,
      'x-device-id': `verified-email-${randomUUID()}`.slice(0, 80),
    },
    body: { action: 'link-account-player', nick },
  });
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.authorized, true);
}

async function syncAccount(environment, accessToken, accountToken) {
  return request(`${environment.apiUrl}/functions/v1/account-auth`, {
    headers: {
      apikey: environment.anonKey,
      authorization: `Bearer ${accessToken}`,
      'x-account-token': accountToken,
      'x-device-id': `verified-auth-${randomUUID()}`.slice(0, 80),
    },
    body: { action: 'sync-account' },
  });
}

const environment = localEnvironment();
const suffix = Date.now().toString(36);
const password = 'Verified1!x';
const email = `verified-${suffix}@example.com`;
const token = randomBytes(32).toString('hex');
const firstNick = `verified${suffix}`.slice(0, 24);
const secondNick = `secured${suffix}`.slice(0, 24);

await linkNick(environment, token, firstNick);
const user = await createAuthUser(environment, email, password, true);
const accessToken = await signIn(environment, email, password);

const firstSync = await syncAccount(environment, accessToken, token);
assert.equal(firstSync.response.status, 200, JSON.stringify(firstSync.body));
assert.deepEqual(firstSync.body.verificationReward, {
  eligible: true,
  active: true,
  granted: true,
  dailyAttemptBonus: 1,
  achievementCode: 'email_verified',
  achievementTitle: 'Cuenta confirmada',
  achievementsGranted: 1,
});

const accountId = psql(environment.databaseUrl, `
  select account_id
  from public.game_auth_identities
  where auth_user_id = ${sqlLiteral(user.id)}::uuid;
`);
assert.match(accountId, /^[0-9a-f-]{36}$/);
assert.equal(psql(environment.databaseUrl, `
  select count(*)
  from public.game_account_entitlements
  where account_id = ${sqlLiteral(accountId)}::uuid
    and entitlement_code = 'verified_email_daily_attempt';
`), '1');
assert.equal(psql(environment.databaseUrl, `
  select count(*)
  from public.game_player_achievements
  where nick_key = ${sqlLiteral(firstNick.toLowerCase())}
    and achievement_code = 'email_verified';
`), '1');

const repeatedSync = await syncAccount(environment, accessToken, token);
assert.equal(repeatedSync.response.status, 200, JSON.stringify(repeatedSync.body));
assert.equal(repeatedSync.body.verificationReward.granted, false);
assert.equal(repeatedSync.body.verificationReward.active, true);
assert.equal(repeatedSync.body.verificationReward.achievementsGranted, 0);

await linkNick(environment, token, secondNick);
assert.equal(psql(environment.databaseUrl, `
  select count(*)
  from public.game_player_achievements
  where nick_key = ${sqlLiteral(secondNick.toLowerCase())}
    and achievement_code = 'email_verified';
`), '1');
process.stdout.write('✓ confirmed email grants one account entitlement and the achievement to current and future nicks\n');

const unverifiedUser = await createAuthUser(
  environment,
  `pending-${suffix}@example.com`,
  password,
  false,
);
const googleUser = await createAuthUser(
  environment,
  `google-${suffix}@example.com`,
  password,
  true,
);
psql(environment.databaseUrl, `
  insert into public.game_auth_identities(
    auth_user_id, account_id, provider, email, email_normalized, email_verified_at
  ) values
    (${sqlLiteral(unverifiedUser.id)}::uuid, ${sqlLiteral(accountId)}::uuid, 'email', 'pending-${suffix}@example.com', 'pending-${suffix}@example.com', null),
    (${sqlLiteral(googleUser.id)}::uuid, ${sqlLiteral(accountId)}::uuid, 'google', 'google-${suffix}@example.com', 'google-${suffix}@example.com', clock_timestamp());
`);
assert.equal(psql(environment.databaseUrl, `select public.grant_game_verified_email_reward(${sqlLiteral(unverifiedUser.id)}::uuid)->>'eligible';`), 'false');
assert.equal(psql(environment.databaseUrl, `select public.grant_game_verified_email_reward(${sqlLiteral(googleUser.id)}::uuid)->>'eligible';`), 'false');
assert.equal(psql(environment.databaseUrl, `select public.grant_game_verified_email_reward(${sqlLiteral(randomUUID())}::uuid)->>'eligible';`), 'false');
process.stdout.write('✓ unconfirmed email and social providers cannot claim the email-confirmation reward\n');
