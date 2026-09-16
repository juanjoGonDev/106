import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';

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
  const databaseUrl = values.DB_URL || values.POSTGRES_URL;
  if (!databaseUrl) throw new Error('Local Supabase database URL is unavailable.');
  return { databaseUrl };
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function runPsql(databaseUrl, sql) {
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

async function runPsqlAsync(databaseUrl, sql) {
  const child = spawn('psql', [
    databaseUrl,
    '--no-psqlrc',
    '--tuples-only',
    '--no-align',
    '--set',
    'ON_ERROR_STOP=1',
    '--command',
    sql,
  ], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const status = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  if (status !== 0) throw new Error(`psql failed: ${stderr || stdout}`);
  return stdout.trim();
}

function jsonPsql(databaseUrl, expression) {
  const output = runPsql(databaseUrl, `select (${expression})::text;`);
  return JSON.parse(output.split(/\r?\n/).filter(Boolean).at(-1));
}

function scalarPsql(databaseUrl, expression) {
  const source = String(expression).trim();
  const statement = /\sfrom\s/i.test(source)
    ? `select ${source};`
    : `select (${source})::text;`;
  return runPsql(databaseUrl, statement).split(/\r?\n/).filter(Boolean).at(-1);
}

function utcInstant(databaseUrl, expression) {
  return runPsql(
    databaseUrl,
    `select to_char((${expression}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');`,
  ).split(/\r?\n/).filter(Boolean).at(-1);
}

function createPlayer(databaseUrl, { nick, tokenHash, deviceHash, ipHash }) {
  const key = nick.toLocaleLowerCase('es');
  const result = jsonPsql(databaseUrl, `public.ensure_game_account_player(
    ${sqlLiteral(nick)}, ${sqlLiteral(key)}, ${sqlLiteral(deviceHash)}, ${sqlLiteral(ipHash)},
    ${sqlLiteral(tokenHash)}, null
  )`);
  assert.equal(result.authorized, true, JSON.stringify(result));
  return key;
}

function insertVerifiedAttempts(databaseUrl, { nick, nickKey, deviceHash, ipHash, day, count }) {
  runPsql(databaseUrl, `
    with generated as (
      select gen_random_uuid() as challenge_id, sequence
      from generate_series(1, ${count}) sequence
    ), challenges as (
      insert into public.game_challenges(
        id, nick, nick_key, team, device_hash, ip_hash,
        started_at, expires_at, consumed_at, quota_day
      )
      select challenge_id, ${sqlLiteral(nick)}, ${sqlLiteral(nickKey)}, 'spain',
        ${sqlLiteral(deviceHash)}, ${sqlLiteral(ipHash)},
        ${sqlLiteral(`${day}T12:00:00.000Z`)}::timestamptz,
        ${sqlLiteral(`${day}T12:01:00.000Z`)}::timestamptz,
        ${sqlLiteral(`${day}T12:00:11.000Z`)}::timestamptz,
        ${sqlLiteral(day)}::date
      from generated
      returning id
    )
    insert into public.game_attempts(
      challenge_id, nick, nick_key, team, device_hash, ip_hash,
      client_elapsed_ms, server_elapsed_ms, difference_ms, verified,
      verification_reasons, client_signals, quota_day, created_at
    )
    select id, ${sqlLiteral(nick)}, ${sqlLiteral(nickKey)}, 'spain',
      ${sqlLiteral(deviceHash)}, ${sqlLiteral(ipHash)},
      10600, 10600, 0, true, '{}'::text[], '{}'::jsonb,
      ${sqlLiteral(day)}::date, ${sqlLiteral(`${day}T12:00:11.000Z`)}::timestamptz
    from challenges;
  `);
}

const { databaseUrl } = readLocalEnvironment();
const suffix = Date.now().toString(36);
const token = () => randomBytes(32).toString('hex');
const hash = (label) => `${label}-${suffix}-${'x'.repeat(48)}`;

assert.equal(
  scalarPsql(databaseUrl, "public.game_server_day('2026-07-31T21:59:59Z'::timestamptz)"),
  '2026-07-31',
);
assert.equal(
  scalarPsql(databaseUrl, "public.game_server_day('2026-07-31T22:00:00Z'::timestamptz)"),
  '2026-08-01',
);
assert.equal(
  utcInstant(databaseUrl, "public.game_server_reset_at('2026-07-31'::date)"),
  '2026-07-31T22:00:00Z',
);
assert.equal(
  scalarPsql(databaseUrl, "public.game_server_day('2026-12-31T22:59:59Z'::timestamptz)"),
  '2026-12-31',
);
assert.equal(
  scalarPsql(databaseUrl, "public.game_server_day('2026-12-31T23:00:00Z'::timestamptz)"),
  '2027-01-01',
);
assert.equal(
  utcInstant(databaseUrl, "public.game_server_reset_at('2026-12-31'::date)"),
  '2026-12-31T23:00:00Z',
);
process.stdout.write('✓ Spain midnight is canonical across summer and winter daylight-saving offsets\n');

const today = scalarPsql(databaseUrl, 'public.game_server_day(clock_timestamp())');
const yesterday = scalarPsql(databaseUrl, 'public.game_server_day(clock_timestamp()) - 1');
const tomorrow = scalarPsql(databaseUrl, 'public.game_server_day(clock_timestamp()) + 1');
const expectedResetAt = utcInstant(databaseUrl, `public.game_server_reset_at(${sqlLiteral(today)}::date)`);

const referrerToken = token();
const referrerNickA = `DailyRefA${suffix}`.slice(0, 24);
const referrerNickB = `DailyRefB${suffix}`.slice(0, 24);
const referrerDevice = hash('referrer-device');
const referrerIp = hash('referrer-ip');
const referrerKeyA = createPlayer(databaseUrl, {
  nick: referrerNickA, tokenHash: referrerToken, deviceHash: referrerDevice, ipHash: referrerIp,
});
const referrerKeyB = createPlayer(databaseUrl, {
  nick: referrerNickB, tokenHash: referrerToken, deviceHash: referrerDevice, ipHash: referrerIp,
});

insertVerifiedAttempts(databaseUrl, {
  nick: referrerNickA, nickKey: referrerKeyA, deviceHash: referrerDevice, ipHash: referrerIp,
  day: yesterday, count: 5,
});
let state = jsonPsql(databaseUrl, `public.get_game_daily_attempt_state(
  ${sqlLiteral(referrerKeyA)}, ${sqlLiteral(`${today}T13:00:00.000Z`)}::timestamptz
)`);
assert.equal(state.attemptsUsed, 0, JSON.stringify(state));
assert.equal(state.attemptsLeft, 5, JSON.stringify(state));
const profileAfterReset = jsonPsql(
  databaseUrl,
  `public.get_game_player_profile(${sqlLiteral(referrerKeyA)})`,
);
assert.equal(profileAfterReset.attemptsUsed, 0, JSON.stringify(profileAfterReset));
assert.equal(profileAfterReset.lifetimeAttemptsUsed, 5, JSON.stringify(profileAfterReset));
assert.equal(profileAfterReset.verifiedAttempts, 5, JSON.stringify(profileAfterReset));
process.stdout.write('✓ previous server-day attempts remain in lifetime profile totals after daily usage resets\n');

insertVerifiedAttempts(databaseUrl, {
  nick: referrerNickA, nickKey: referrerKeyA, deviceHash: referrerDevice, ipHash: referrerIp,
  day: today, count: 5,
});
state = jsonPsql(databaseUrl, `public.get_game_daily_attempt_state(
  ${sqlLiteral(referrerKeyA)}, ${sqlLiteral(`${today}T13:00:00.000Z`)}::timestamptz
)`);
assert.equal(state.attemptsUsed, 5, JSON.stringify(state));
assert.equal(state.attemptsLeft, 0, JSON.stringify(state));
assert.equal(state.maxAttempts, 5, JSON.stringify(state));
assert.equal(Date.parse(state.dailyResetAt), Date.parse(expectedResetAt));
process.stdout.write('✓ five current-day attempts exhaust the base quota with an exact Spain-midnight reset\n');

const referredToken = token();
const referredNickA = `DailyNewA${suffix}`.slice(0, 24);
const referredNickB = `DailyNewB${suffix}`.slice(0, 24);
const referredDevice = hash('referred-device');
const referredIp = hash('referred-ip');
const referredKeyA = createPlayer(databaseUrl, {
  nick: referredNickA, tokenHash: referredToken, deviceHash: referredDevice, ipHash: referredIp,
});
const referredKeyB = createPlayer(databaseUrl, {
  nick: referredNickB, tokenHash: referredToken, deviceHash: referredDevice, ipHash: referredIp,
});
const referralCode = scalarPsql(databaseUrl, `referral_code from public.game_players where nick_key = ${sqlLiteral(referrerKeyA)}`);

const registered = jsonPsql(databaseUrl, `public.register_game_account_referral(
  ${sqlLiteral(referralCode)}::uuid, ${sqlLiteral(referredKeyA)},
  ${sqlLiteral(referredDevice)}, ${sqlLiteral(referredIp)}
)`);
assert.equal(registered.registered, true, JSON.stringify(registered));
const duplicateAccount = jsonPsql(databaseUrl, `public.register_game_account_referral(
  ${sqlLiteral(referralCode)}::uuid, ${sqlLiteral(referredKeyB)},
  ${sqlLiteral(referredDevice)}, ${sqlLiteral(referredIp)}
)`);
assert.equal(duplicateAccount.registered, false, JSON.stringify(duplicateAccount));
assert.equal(duplicateAccount.reason, 'account_already_referred');
const selfReferral = jsonPsql(databaseUrl, `public.register_game_account_referral(
  ${sqlLiteral(referralCode)}::uuid, ${sqlLiteral(referrerKeyB)},
  ${sqlLiteral(referrerDevice)}, ${sqlLiteral(referrerIp)}
)`);
assert.equal(selfReferral.registered, false, JSON.stringify(selfReferral));
assert.equal(selfReferral.reason, 'same_account');
process.stdout.write('✓ one canonical account can consume one referral regardless of linked nicks\n');

insertVerifiedAttempts(databaseUrl, {
  nick: referredNickA, nickKey: referredKeyA, deviceHash: referredDevice, ipHash: referredIp,
  day: today, count: 3,
});
insertVerifiedAttempts(databaseUrl, {
  nick: referredNickB, nickKey: referredKeyB, deviceHash: referredDevice, ipHash: referredIp,
  day: today, count: 2,
});
const referredAccountId = scalarPsql(databaseUrl, `public.game_account_id_for_nick(${sqlLiteral(referredKeyA)})`);
const completionSql = `select public.complete_game_account_referral(${sqlLiteral(referredAccountId)}::uuid, clock_timestamp())::text;`;
const completions = await Promise.all([
  runPsqlAsync(databaseUrl, completionSql),
  runPsqlAsync(databaseUrl, completionSql),
]);
const completionBodies = completions.map((output) => JSON.parse(output.split(/\r?\n/).filter(Boolean).at(-1)));
assert.equal(completionBodies.filter((result) => result.completed === true).length, 1, JSON.stringify(completionBodies));
assert.equal(runPsql(databaseUrl, `select count(*) from public.game_referrals where referred_account_id = ${sqlLiteral(referredAccountId)}::uuid and completed_at is not null;`).split(/\r?\n/).at(-1), '1');
process.stdout.write('✓ concurrent fifth-attempt completion grants one referral reward\n');

for (const nickKey of [referrerKeyA, referrerKeyB]) {
  const accountState = jsonPsql(databaseUrl, `public.get_game_daily_attempt_state(
    ${sqlLiteral(nickKey)}, ${sqlLiteral(`${today}T13:00:00.000Z`)}::timestamptz
  )`);
  assert.equal(accountState.bonusAttempts, 1, JSON.stringify(accountState));
  assert.equal(accountState.maxAttempts, 6, JSON.stringify(accountState));
}
process.stdout.write('✓ the referral bonus increases every nick on the referrer account\n');

const referrerAccountId = scalarPsql(databaseUrl, `public.game_account_id_for_nick(${sqlLiteral(referrerKeyA)})`);
runPsql(databaseUrl, `
  do $block$
  declare
    v_index integer;
    v_account_id uuid;
    v_nick_key text;
  begin
    for v_index in 1..6 loop
      insert into public.game_accounts(token_hash)
      values (encode(gen_random_bytes(32), 'hex'))
      returning id into v_account_id;
      v_nick_key := lower(${sqlLiteral(`Cap${suffix}`)}) || v_index::text;
      insert into public.game_players(nick_key, nick, referral_code, first_device_hash, first_ip_hash)
      values (v_nick_key, v_nick_key, gen_random_uuid(), encode(gen_random_bytes(32), 'hex'), encode(gen_random_bytes(32), 'hex'));
      insert into public.game_account_players(account_id, nick_key) values (v_account_id, v_nick_key);
      insert into public.game_player_bonus(nick_key) values (v_nick_key) on conflict do nothing;
      insert into public.game_referrals(
        referral_code, referrer_nick_key, referred_nick_key, referred_device_hash, referred_ip_hash,
        referrer_account_id, referred_account_id, reward_eligible, completed_at
      ) values (
        gen_random_uuid(), ${sqlLiteral(referrerKeyA)}, v_nick_key,
        encode(gen_random_bytes(32), 'hex'), encode(gen_random_bytes(32), 'hex'),
        ${sqlLiteral(referrerAccountId)}::uuid, v_account_id, true, clock_timestamp()
      );
    end loop;
  end;
  $block$;
`);
const capped = jsonPsql(databaseUrl, `public.get_game_daily_attempt_state(
  ${sqlLiteral(referrerKeyB)}, ${sqlLiteral(`${tomorrow}T13:00:00.000Z`)}::timestamptz
)`);
assert.equal(capped.bonusAttempts, 5, JSON.stringify(capped));
assert.equal(capped.maxAttempts, 10, JSON.stringify(capped));
process.stdout.write('✓ account referral growth is capped at ten daily attempts per nick\n');

process.stdout.write('Local daily attempt and referral limit suite completed.\n');
