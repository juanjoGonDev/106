import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

function environment() {
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
  const databaseUrl = values.DB_URL || values.POSTGRES_URL;
  if (!databaseUrl) throw new Error('Local Supabase database URL is unavailable.');
  return { databaseUrl };
}

function literal(value) {
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
  return result.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) || '';
}

function json(databaseUrl, expression) {
  return JSON.parse(psql(databaseUrl, `select (${expression})::text;`));
}

function createPlayer(databaseUrl, nick, tokenHash, deviceHash, ipHash) {
  const nickKey = nick.toLowerCase();
  const result = json(databaseUrl, `public.ensure_game_account_player(
    ${literal(nick)}, ${literal(nickKey)}, ${literal(deviceHash)}, ${literal(ipHash)},
    ${literal(tokenHash)}, null
  )`);
  assert.equal(result.authorized, true, JSON.stringify(result));
  return nickKey;
}

const { databaseUrl } = environment();
const suffix = Date.now().toString(36);

const noPlayerAuthUserId = randomUUID();
const noPlayerTokenHash = randomBytes(32).toString('hex');
const preparedAccount = json(databaseUrl, `public.prepare_game_auth_link(
  ${literal(noPlayerAuthUserId)}::uuid,
  'email',
  ${literal(`no-player-${suffix}@example.com`)},
  true,
  null,
  ${literal(noPlayerTokenHash)}
)`);
assert.equal(preparedAccount.created, true, JSON.stringify(preparedAccount));
json(databaseUrl, `public.record_game_auth_origin(${literal(noPlayerAuthUserId)}::uuid, 'email')`);
const noPlayerReward = json(databaseUrl, `public.grant_game_auth_link_reward(${literal(noPlayerAuthUserId)}::uuid)`);
assert.equal(noPlayerReward.dailyAttemptBonus, 1, JSON.stringify(noPlayerReward));
const noPlayerPolicy = json(databaseUrl, `public.get_game_auth_daily_attempt_policy(${literal(noPlayerAuthUserId)}::uuid, clock_timestamp())`);
assert.equal(noPlayerPolicy.attemptsUsed, 0, JSON.stringify(noPlayerPolicy));
assert.equal(noPlayerPolicy.dailyAttemptsReserved, 0, JSON.stringify(noPlayerPolicy));
assert.equal(noPlayerPolicy.attemptsLeft, 6, JSON.stringify(noPlayerPolicy));
assert.equal(noPlayerPolicy.maxAttempts, 6, JSON.stringify(noPlayerPolicy));
assert.equal(noPlayerPolicy.bonusAttempts, 1, JSON.stringify(noPlayerPolicy));
assert.equal(noPlayerPolicy.authRewardBonus, 1, JSON.stringify(noPlayerPolicy));
const noPlayerTokenPolicy = json(databaseUrl, `public.get_game_account_daily_attempt_policy_by_token(${literal(noPlayerTokenHash)}, clock_timestamp())`);
assert.deepEqual(noPlayerTokenPolicy, noPlayerPolicy);
assert.equal(psql(databaseUrl, `
  select count(*)
  from public.game_account_players player
  join public.game_auth_identities identity on identity.account_id = player.account_id
  where identity.auth_user_id = ${literal(noPlayerAuthUserId)}::uuid;
`), '0');
process.stdout.write('✓ confirmed authentication policy exposes six daily attempts before a nick exists\n');

const tokenHash = randomBytes(32).toString('hex');
const deviceHash = `auth-device-${suffix}-${'d'.repeat(40)}`;
const ipHash = `auth-ip-${suffix}-${'i'.repeat(44)}`;
const firstNick = `AuthBonusA${suffix}`.slice(0, 24);
const secondNick = `AuthBonusB${suffix}`.slice(0, 24);
const firstKey = createPlayer(databaseUrl, firstNick, tokenHash, deviceHash, ipHash);
const secondKey = createPlayer(databaseUrl, secondNick, tokenHash, deviceHash, ipHash);
const accountId = psql(databaseUrl, `select public.game_account_id_for_nick(${literal(firstKey)})::text;`);

let firstState = json(databaseUrl, `public.get_game_daily_attempt_state(${literal(firstKey)}, clock_timestamp())`);
assert.equal(firstState.maxAttempts, 5, JSON.stringify(firstState));
assert.equal(firstState.authRewardBonus, 0, JSON.stringify(firstState));
assert.equal(firstState.emailVerificationBonus, 0, JSON.stringify(firstState));

psql(databaseUrl, `
  insert into public.game_account_entitlements(
    account_id, entitlement_code, auth_user_id, metadata
  ) values (
    ${literal(accountId)}::uuid,
    'auth_identity_daily_attempt',
    gen_random_uuid(),
    jsonb_build_object('dailyAttemptBonus', 1, 'source', 'social_link', 'provider', 'google')
  ) on conflict (account_id, entitlement_code) do nothing;
`);

for (const nickKey of [firstKey, secondKey]) {
  const state = json(databaseUrl, `public.get_game_daily_attempt_state(${literal(nickKey)}, clock_timestamp())`);
  assert.equal(state.authRewardBonus, 1, JSON.stringify(state));
  assert.equal(state.emailVerificationBonus, 1, JSON.stringify(state));
  assert.equal(state.bonusAttempts, 1, JSON.stringify(state));
  assert.equal(state.maxAttempts, 6, JSON.stringify(state));
  const policy = json(databaseUrl, `public.get_game_account_daily_attempt_policy(${literal(accountId)}::uuid, clock_timestamp())`);
  assert.equal(policy.maxAttempts, state.maxAttempts, JSON.stringify({ policy, state }));
  assert.equal(policy.bonusAttempts, state.bonusAttempts, JSON.stringify({ policy, state }));
}
process.stdout.write('✓ one authentication entitlement adds one daily attempt to every nick on the account\n');

psql(databaseUrl, `
  insert into public.game_account_entitlements(account_id, entitlement_code, auth_user_id)
  values (${literal(accountId)}::uuid, 'auth_identity_daily_attempt', gen_random_uuid())
  on conflict (account_id, entitlement_code) do nothing;
`);
assert.equal(psql(databaseUrl, `
  select count(*)
  from public.game_account_entitlements
  where account_id = ${literal(accountId)}::uuid
    and entitlement_code = 'auth_identity_daily_attempt';
`), '1');
process.stdout.write('✓ repeated Google or email reward processing cannot stack the entitlement\n');

psql(databaseUrl, `
  update public.game_player_bonus
  set bonus_attempts = 4,
      updated_at = clock_timestamp()
  where nick_key = ${literal(firstKey)};
`);
firstState = json(databaseUrl, `public.get_game_daily_attempt_state(${literal(firstKey)}, clock_timestamp())`);
assert.equal(firstState.authRewardBonus, 1, JSON.stringify(firstState));
assert.equal(firstState.bonusAttempts, 5, JSON.stringify(firstState));
assert.equal(firstState.maxAttempts, 10, JSON.stringify(firstState));
process.stdout.write('✓ authentication reward contributes inside the existing absolute maximum of ten\n');

psql(databaseUrl, `
  delete from public.game_account_entitlements
  where account_id = ${literal(accountId)}::uuid
    and entitlement_code = 'auth_identity_daily_attempt';
  insert into public.game_account_entitlements(account_id, entitlement_code, auth_user_id, metadata)
  values (
    ${literal(accountId)}::uuid,
    'verified_email_daily_attempt',
    gen_random_uuid(),
    jsonb_build_object('source', 'email_confirmation')
  );
`);
assert.equal(psql(databaseUrl, `select public.game_account_auth_daily_bonus(${literal(accountId)}::uuid);`), '1');
process.stdout.write('✓ legacy verified-email entitlement remains compatible during rolling deployment\n');
