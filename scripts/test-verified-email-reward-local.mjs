import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const origin = 'http://127.0.0.1:3000';
const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

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
    },
  });
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  if (provider !== 'email') {
    psql(environment.databaseUrl, `
      update auth.users
      set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
        || jsonb_build_object(
          'provider', ${sqlLiteral(provider)},
          'providers', jsonb_build_array(${sqlLiteral(provider)})
        )
      where id = ${sqlLiteral(result.body.id)}::uuid;
    `);
  }
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

function dailyAttemptState(databaseUrl, nick) {
  return JSON.parse(psql(databaseUrl, `
    select public.get_game_daily_attempt_state(
      lower(${sqlLiteral(nick)}),
      clock_timestamp()
    )::text;
  `));
}

function assertSingleAuthDailyBonus(state) {
  assert.equal(state.dailyLimitBase, 5, JSON.stringify(state));
  assert.equal(state.authRewardBonus, 1, JSON.stringify(state));
  assert.equal(state.emailVerificationBonus, 1, JSON.stringify(state));
  assert.equal(state.bonusAttempts, 1, JSON.stringify(state));
  assert.equal(state.maxAttempts, 6, JSON.stringify(state));
  assert.equal(state.attemptsLeft, 6, JSON.stringify(state));
  assert.equal(state.dailyLimitCeiling, 10, JSON.stringify(state));
}

function createGameAccount(databaseUrl) {
  const output = psql(databaseUrl, `
    insert into public.game_accounts(token_hash)
    values (${sqlLiteral(randomBytes(32).toString('hex'))})
    returning id;
  `);
  const accountId = output.match(uuidPattern)?.[0] || '';
  assert.match(accountId, uuidPattern, output);
  return accountId;
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
assert.match(emailAccountId, uuidPattern);
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
assertSingleAuthDailyBonus(dailyAttemptState(environment.databaseUrl, firstNick));

const repeatedEmailSync = await syncAccount(environment, emailAccessToken, emailToken);
assert.equal(repeatedEmailSync.response.status, 200, JSON.stringify(repeatedEmailSync.body));
assert.equal(repeatedEmailSync.body.authReward.granted, false);
assert.equal(repeatedEmailSync.body.authReward.active, true);
assert.equal(repeatedEmailSync.body.authReward.source, 'email_confirmation');
assert.equal(repeatedEmailSync.body.authReward.achievementsGranted, 0);
assertSingleAuthDailyBonus(dailyAttemptState(environment.databaseUrl, firstNick));

await linkNick(environment, emailToken, secondNick);
assert.equal(psql(environment.databaseUrl, `
  select count(*)
  from public.game_player_achievements
  where nick_key = ${sqlLiteral(secondNick.toLowerCase())}
    and achievement_code = 'email_verified';
`), '1');
assertSingleAuthDailyBonus(dailyAttemptState(environment.databaseUrl, secondNick));
process.stdout.write('✓ confirmed email grants one account reward, one achievement and a total daily limit of six to every nick\n');

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
assertSingleAuthDailyBonus(dailyAttemptState(environment.databaseUrl, firstNick));
assertSingleAuthDailyBonus(dailyAttemptState(environment.databaseUrl, secondNick));
process.stdout.write('✓ an email-origin account cannot stack the social reward or raise its daily limit above six\n');

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
assertSingleAuthDailyBonus(dailyAttemptState(environment.databaseUrl, socialNick));

const socialAccountId = accountIdForUser(environment.databaseUrl, googleUser.id);
assert.match(socialAccountId, uuidPattern);
assert.equal(psql(environment.databaseUrl, `
  select count(*)
  from public.game_auth_identities identity
  where public.resolve_game_account_id(identity.account_id) = ${sqlLiteral(socialAccountId)}::uuid
    and identity.origin_provider = 'google';
`), '1');
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
assertSingleAuthDailyBonus(dailyAttemptState(environment.databaseUrl, socialNick));
process.stdout.write('✓ Google social access grants one account reward and a total daily limit of six\n');

const pendingEmail = `pending-${suffix}@example.com`;
const pendingUser = await createAuthUser(environment, pendingEmail, password, { confirmed: false });
const pendingAccountId = createGameAccount(environment.databaseUrl);
psql(environment.databaseUrl, `
  insert into public.game_auth_identities(
    auth_user_id,
    account_id,
    provider,
    origin_provider,
    email,
    email_normalized,
    email_verified_at
  ) values (
    ${sqlLiteral(pendingUser.id)}::uuid,
    ${sqlLiteral(pendingAccountId)}::uuid,
    'email',
    'email',
    ${sqlLiteral(pendingEmail)},
    ${sqlLiteral(pendingEmail)},
    null
  );
`);
const pendingReward = JSON.parse(psql(environment.databaseUrl, `
  select public.grant_game_auth_link_reward(${sqlLiteral(pendingUser.id)}::uuid)::text;
`));
assert.deepEqual(pendingReward, {
  eligible: true,
  active: false,
  granted: false,
  pendingConfirmation: true,
  dailyAttemptBonus: 0,
  source: 'email_confirmation',
  provider: 'email',
});
assert.equal(psql(environment.databaseUrl, `
  select public.grant_game_auth_link_reward(${sqlLiteral(randomUUID())}::uuid)->>'eligible';
`), 'false');
process.stdout.write('✓ unconfirmed and missing identities cannot claim a reward before activation\n');