import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

function readLocalDatabaseUrl() {
  const result = spawnSync('supabase', ['status', '-o', 'env'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`supabase status failed: ${result.stderr || result.stdout}`);
  }

  const values = {};
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(?:"([^"]*)"|'([^']*)'|(.*))$/);
    if (match) values[match[1]] = match[2] ?? match[3] ?? match[4] ?? '';
  }

  const databaseUrl = values.DB_URL || values.POSTGRES_URL;
  if (!databaseUrl) throw new Error('Local Supabase database URL is unavailable.');
  return databaseUrl;
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

function jsonPsql(databaseUrl, expression) {
  const output = runPsql(databaseUrl, `select (${expression})::text;`);
  return JSON.parse(output.split(/\r?\n/).filter(Boolean).at(-1));
}

function insertVerifiedAttempts(databaseUrl, fixture, day, count) {
  runPsql(databaseUrl, `
    with generated as (
      select gen_random_uuid() as challenge_id
      from generate_series(1, ${count})
    ), challenges as (
      insert into public.game_challenges(
        id, nick, nick_key, team, device_hash, ip_hash,
        started_at, expires_at, consumed_at, quota_day
      )
      select challenge_id,
        ${sqlLiteral(fixture.nick)},
        ${sqlLiteral(fixture.nickKey)},
        'spain',
        ${sqlLiteral(fixture.deviceHash)},
        ${sqlLiteral(fixture.ipHash)},
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
    select id,
      ${sqlLiteral(fixture.nick)},
      ${sqlLiteral(fixture.nickKey)},
      'spain',
      ${sqlLiteral(fixture.deviceHash)},
      ${sqlLiteral(fixture.ipHash)},
      10600,
      10600,
      0,
      true,
      '{}'::text[],
      '{}'::jsonb,
      ${sqlLiteral(day)}::date,
      ${sqlLiteral(`${day}T12:00:11.000Z`)}::timestamptz
    from challenges;
  `);
}

function accountPlayer(databaseUrl, tokenHash, nickKey) {
  const account = jsonPsql(
    databaseUrl,
    `public.get_game_account_players(${sqlLiteral(tokenHash)})`,
  );
  assert.equal(account.exists, true, JSON.stringify(account));
  const player = account.players.find((candidate) => candidate.nickKey === nickKey);
  assert.ok(player, JSON.stringify(account));
  return player;
}

const databaseUrl = readLocalDatabaseUrl();
const suffix = Date.now().toString(36);
const tokenHash = randomBytes(32).toString('hex');
const fixture = {
  nick: `QuotaAccount${suffix}`.slice(0, 24),
  deviceHash: randomBytes(32).toString('hex'),
  ipHash: randomBytes(32).toString('hex'),
};
fixture.nickKey = fixture.nick.toLocaleLowerCase('es');

const created = jsonPsql(databaseUrl, `public.ensure_game_account_player(
  ${sqlLiteral(fixture.nick)},
  ${sqlLiteral(fixture.nickKey)},
  ${sqlLiteral(fixture.deviceHash)},
  ${sqlLiteral(fixture.ipHash)},
  ${sqlLiteral(tokenHash)},
  null
)`);
assert.equal(created.authorized, true, JSON.stringify(created));

const today = runPsql(
  databaseUrl,
  'select public.game_server_day(clock_timestamp())::text;',
).split(/\r?\n/).at(-1);
const yesterday = runPsql(
  databaseUrl,
  'select (public.game_server_day(clock_timestamp()) - 1)::text;',
).split(/\r?\n/).at(-1);

insertVerifiedAttempts(databaseUrl, fixture, yesterday, 7);
let player = accountPlayer(databaseUrl, tokenHash, fixture.nickKey);
assert.equal(player.lifetimeAttemptsUsed, 7, JSON.stringify(player));
assert.equal(player.attemptsUsed, 0, JSON.stringify(player));
assert.equal(player.dailyAttemptsUsed, 0, JSON.stringify(player));
assert.equal(player.attemptsLeft, 5, JSON.stringify(player));
assert.equal(player.maxAttempts, 5, JSON.stringify(player));
process.stdout.write('✓ seven historical attempts do not consume the linked player current-day quota\n');

insertVerifiedAttempts(databaseUrl, fixture, today, 5);
player = accountPlayer(databaseUrl, tokenHash, fixture.nickKey);
assert.equal(player.lifetimeAttemptsUsed, 12, JSON.stringify(player));
assert.equal(player.attemptsUsed, 5, JSON.stringify(player));
assert.equal(player.dailyAttemptsUsed, 5, JSON.stringify(player));
assert.equal(player.attemptsLeft, 0, JSON.stringify(player));
assert.equal(player.maxAttempts, 5, JSON.stringify(player));
process.stdout.write('✓ linked-player quota projection reports current-day exhaustion independently\n');

process.stdout.write('Local linked-player daily quota regression suite completed.\n');
