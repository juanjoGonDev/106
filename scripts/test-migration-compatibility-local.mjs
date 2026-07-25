import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const migrationPath = 'supabase/migrations/20260724213350_adopt_legacy_player_achievement_highlights.sql';

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
  if (!databaseUrl) throw new Error('Local Supabase DB_URL is missing.');
  return databaseUrl;
}

function psql(databaseUrl, args) {
  const result = spawnSync('psql', [
    databaseUrl,
    '--no-psqlrc',
    '--set',
    'ON_ERROR_STOP=1',
    ...args,
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`psql failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

function execute(databaseUrl, sql) {
  return psql(databaseUrl, ['--command', sql]);
}

function query(databaseUrl, sql) {
  return psql(databaseUrl, ['--tuples-only', '--no-align', '--command', sql]);
}

function applyCompatibilityMigration(databaseUrl) {
  assert.match(readFileSync(migrationPath, 'utf8'), /player_achievement_highlights/);
  psql(databaseUrl, ['--file', migrationPath]);
}

const databaseUrl = readLocalEnvironment();

execute(databaseUrl, `
  drop table if exists public.player_achievement_highlights;
  create table public.player_achievement_highlights (
    player_nick_key text not null references public.game_players(nick_key) on delete cascade,
    achievement_code text not null,
    position smallint not null,
    created_at timestamptz not null default timezone('utc'::text, now()),
    updated_at timestamptz not null default timezone('utc'::text, now()),
    constraint player_achievement_highlights_pkey primary key (player_nick_key, achievement_code),
    constraint player_achievement_highlights_position_check check (position >= 1 and position <= 3)
  );

  with candidate as (
    select achievement.nick_key
    from public.game_player_achievements achievement
    where not exists (
      select 1
      from public.game_player_featured_achievements current_selection
      where current_selection.nick_key = achievement.nick_key
    )
    group by achievement.nick_key
    having count(*) >= 3
    order by count(*) desc, achievement.nick_key
    limit 1
  ), ranked as (
    select
      achievement.nick_key,
      achievement.achievement_code,
      row_number() over (order by achievement.achievement_code desc) as source_order
    from public.game_player_achievements achievement
    join candidate using (nick_key)
  )
  insert into public.player_achievement_highlights (
    player_nick_key,
    achievement_code,
    position,
    created_at,
    updated_at
  )
  select
    ranked.nick_key,
    ranked.achievement_code,
    case ranked.source_order
      when 1 then 3
      when 2 then 1
      when 3 then 1
      else 2
    end::smallint,
    clock_timestamp() - ranked.source_order * interval '1 minute',
    clock_timestamp() - ranked.source_order * interval '1 minute'
  from ranked
  where ranked.source_order <= 4;
`);

const fixture = JSON.parse(query(databaseUrl, `
  select json_build_object(
    'nickKey', min(legacy.player_nick_key),
    'count', count(*)::integer,
    'expectedCodes', json_agg(legacy.achievement_code order by legacy.position, legacy.achievement_code)
  )
  from public.player_achievement_highlights legacy;
`));
assert.ok(fixture.nickKey, 'The full API journey must create achievements before the compatibility test.');
assert.ok(fixture.count >= 3, `Expected at least three legacy achievements, received ${fixture.count}.`);

applyCompatibilityMigration(databaseUrl);

const migrated = JSON.parse(query(databaseUrl, `
  select json_build_object(
    'codes', coalesce(json_agg(selection.achievement_code order by selection.position), '[]'::json),
    'positions', coalesce(json_agg(selection.position order by selection.position), '[]'::json)
  )
  from public.game_player_featured_achievements selection
  where selection.nick_key = '${fixture.nickKey.replaceAll("'", "''")}'
    and selection.active = true;
`));
assert.deepEqual(migrated.codes, fixture.expectedCodes.slice(0, 3));
assert.deepEqual(migrated.positions, [1, 2, 3]);

const permissions = JSON.parse(query(databaseUrl, `
  select json_build_object(
    'rlsEnabled', relation.relrowsecurity,
    'anonSelect', has_table_privilege('anon', relation.oid, 'SELECT'),
    'authenticatedSelect', has_table_privilege('authenticated', relation.oid, 'SELECT'),
    'serviceSelect', has_table_privilege('service_role', relation.oid, 'SELECT')
  )
  from pg_class relation
  join pg_namespace namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public'
    and relation.relname = 'player_achievement_highlights';
`));
assert.equal(permissions.rlsEnabled, true);
assert.equal(permissions.anonSelect, false);
assert.equal(permissions.authenticatedSelect, false);
assert.equal(permissions.serviceSelect, true);

applyCompatibilityMigration(databaseUrl);
const migratedAgain = JSON.parse(query(databaseUrl, `
  select json_build_object(
    'codes', coalesce(json_agg(selection.achievement_code order by selection.position), '[]'::json),
    'positions', coalesce(json_agg(selection.position order by selection.position), '[]'::json)
  )
  from public.game_player_featured_achievements selection
  where selection.nick_key = '${fixture.nickKey.replaceAll("'", "''")}'
    and selection.active = true;
`));
assert.deepEqual(migratedAgain, migrated);

execute(databaseUrl, `
  delete from public.game_player_featured_achievements
  where nick_key = '${fixture.nickKey.replaceAll("'", "''")}';
  drop table public.player_achievement_highlights;
`);

process.stdout.write('✓ Legacy player achievement highlights upgrade is data-preserving, restricted and idempotent\n');
