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

async function createAuthUser(environment, email, password, options = {}) {
  const provider = options.provider || 'email';
  const result = await request(`${environment.apiUrl}/auth/v1/admin/users`, {
    headers: {
      apikey: environment.serviceRoleKey,
      authorization: `Bearer ${environment.serviceRoleKey}`,
    },
    body: {
      email,
      password,
      email_confirm: options.confirmed !== false,
      app_metadata: { provider, providers: [provider] },
    },
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
      'x-device-id': `auth-reward-${randomUUID()}`.slice(0, 80),
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

function accountIdForUser(databaseUrl, userId) {
  return psql(databaseUrl, `
    select public.resolve_game_account_id(account_id)
    from public.game_auth_identities
    where auth_user_id = ${sqlLiteral(userId)}::uuid;
  `);
}

const environment = localEnvironment();
const suffix = Date.now().toString(36);
const password = 'Verified1!x';

const emailAddress = `verified-${suffix}@example.com`;
const emailToken = randomBytes(32).toString('hex');
const firstNick = `verified${suffix}`.slice(0, 24);
const secondNick = `secured${suffix}`.slice(0, 24);

await linkNick(environment, emailToken, firstNick);
const emailUser = await createAuthUser(environment, emailAddress, password);
const emailAccessToken = await signIn(environment, emailAddress, password);

const firstEmailSync = await syncAccount(environment, emailAccessToken, emailToken);
assert.equal(firstEmailSync.response.status, 200, JSON.stringify(firstEmailSync.body));
assert.deepEqual(firstEmailSync.body.authReward, {
  eligible: true,
  active: true,
  granted: true,
  dailyAttemptBonus: 1,
  source: 'email_confirmation',
  provider: 'email',
  achievementCode: 'email_verified',
  achievementTitle: 'Cuenta confirmada',
  achievementsGranted: 1,
});

const emailAccountId = accountIdForUser(environment.databaseUrl, emailUser.id);
assert.match(emailAccountId, /^[0-9a-f-]{36}$/);
assert.equal(psql(environment.databaseUrl, `
  select count(*)
  from public.game_account_entitlements entitlement
  where public.resolve_game_account_id(entitlement.account_id) = ${sqlLiteral(emailAccountId)}::uuid
    and entitlement.entitlement_code = 'auth_identity_daily_attempt';
`), '1');
assert.equal(psql(environment.databaseUrl, `
  select public.game_account_auth_daily_bonus(${sqlLiteral(emailAccountId)}::uuid);
`), '1');
assert.equal(psql(environment.databaseUrl, `
  select count(*)
  from public.game_player_achievements
  where nick_key = ${sqlLiteral(firstNick.toLowerCase())}
    and achievement_code = 'email_verified';
`), '1');

const repeatedEmailSync = await syncAccount(environment, emailAccessToken, emailToken);
assert.equal(repeatedEmailSync.response.status, 200, JSON.stringify(repeatedEmailSync.body));
assert.equal(repeatedEmailSync.body.authReward.granted, false);
assert.equal(repeatedEmailSync.body.authReward.active, true);
assert.equal(repeatedEmailSync.body.authReward.source, 'email_confirmation');
assert.equal(repeatedEmailSync.body.authReward.achievementsGranted, 0);

await linkNick(environment, emailToken, secondNick);
assert.equal(psql(environment.databaseUrl, `
  select count(*)
  from public.game_player_achievements
  where nick_key = ${sqlLiteral(secondNick.toLowerCase())}
    and achievement_code = 'email_verified';
`), '1');
process.stdout.write('✓ confirmed email grants one account reward and the achievement to current and future nicks\n');

const emailAccountGoogle = `email-google-${suffix}@example.com`;
const emailAccountGoogleUser = await createAuthUser(environment, emailAccountGoogle, password, { provider: 'google' });
const emailAccountGoogleAccess = await signIn(environment, emailAccountGoogle, password);
const emailAccountGoogleSync = await syncAccount(environment, emailAccountGoogleAccess, emailToken);
assert.equal(emailAccountGoogleSync.response.status, 200, JSON.stringify(emailAccountGoogleSync.body));
assert.equal(emailAccountGoogleSync.body.authReward.granted, false);
assert.equal(emailAccountGoogleSync.body.authReward.source, 'email_confirmation');
assert.equal(accountIdForUser(environment.databaseUrl, emailAccountGoogleUser.id), emailAccountId);
assert.equal(psql(environment.databaseUrl, `
  select count(*)
  from public.game_account_entitlements entitlement
  where public.resolve_game_account_id(entitlement.account_id) = ${sqlLiteral(emailAccountId)}::uuid;
`), '1');
process.stdout.write('✓ an email-origin account cannot stack the social reward later\n');

const socialToken = randomBytes(32).toString('hex');
const socialNick = `social${suffix}`.slice(0, 24);
await linkNick(environment, socialToken, socialNick);

const googleEmail = `google-${suffix}@example.com`;
const googleUser = await createAuthUser(environment, googleEmail, password, { provider: 'google' });
const googleAccessToken = await signIn(environment, googleEmail, password);
const googleSync = await syncAccount(environment, googleAccessToken, socialToken);
assert.equal(googleSync.response.status, 200, JSON.stringify(googleSync.body));
assert.equal(googleSync.body.authReward.eligible, true);
assert.equal(googleSync.body.authReward.active, true);
assert.equal(googleSync.body.authReward.granted, true);
assert.equal(googleSync.body.authReward.dailyAttemptBonus, 1);
assert.equal(googleSync.body.authReward.source, 'social_link');
assert.equal(googleSync.body.authReward.provider, 'google');
assert.equal(googleSync.body.authReward.achievementCode, null);
assert.equal(googleSync.body.authReward.achievementTitle, null);
assert.equal(googleSync.body.authReward.achievementsGranted, 0);

const socialAccountId = accountIdForUser(environment.databaseUrl, googleUser.id);
const facebookEmail = `facebook-${suffix}@example.com`;
const facebookUser = await createAuthUser(environment, facebookEmail, password, { provider: 'facebook' });
const facebookAccessToken = await signIn(environment, facebookEmail, password);
const facebookSync = await syncAccount(environment, facebookAccessToken, socialToken);
assert.equal(facebookSync.response.status, 200, JSON.stringify(facebookSync.body));
assert.equal(facebookSync.body.authReward.granted, false);
assert.equal(facebookSync.body.authReward.active, true);
assert.equal(facebookSync.body.authReward.source, 'social_link');
assert.equal(facebookSync.body.authReward.provider, 'google');
assert.equal(accountIdForUser(environment.databaseUrl, facebookUser.id), socialAccountId);
assert.equal(psql(environment.databaseUrl, `
  select count(*)
  from public.game_auth_identities identity
  where public.resolve_game_account_id(identity.account_id) = ${sqlLiteral(socialAccountId)}::uuid
    and identity.origin_provider in ('google', 'facebook');
`), '2');
assert.equal(psql(environment.databaseUrl, `
  select count(*)
  from public.game_account_entitlements entitlement
  where public.resolve_game_account_id(entitlement.account_id) = ${sqlLiteral(socialAccountId)}::uuid
    and entitlement.entitlement_code = 'auth_identity_daily_attempt';
`), '1');
assert.equal(psql(environment.databaseUrl, `
  select count(*)
  from public.game_player_achievements
  where nick_key = ${sqlLiteral(socialNick.toLowerCase())}
    and achievement_code = 'email_verified';
`), '0');
process.stdout.write('✓ Google and Facebook can share one game account while granting only one social attempt\n');

const pendingUser = await createAuthUser(
  environment,
  `pending-${suffix}@example.com`,
  password,
  { confirmed: false },
);
psql(environment.databaseUrl, `
  insert into public.game_auth_identities(
    auth_user_id, account_id, provider, origin_provider,
    email, email_normalized, email_verified_at
  ) values (
    ${sqlLiteral(pendingUser.id)}::uuid,
    ${sqlLiteral(randomUUID())}::uuid,
    'email',
    'email',
    'pending-${suffix}@example.com',
    'pending-${suffix}@example.com',
    null
  );
`);
