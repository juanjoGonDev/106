import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const migrationPath = 'supabase/migrations/20260724213350_adopt_legacy_player_achievement_highlights.sql';
const playerIdPreparationMigrationPath = 'supabase/migrations/20260811132900_prepare_legacy_player_id_backfill.sql';
const copyNickKey = 'migration-copy';
const preserveNickKey = 'migration-preserve';

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

function assertLegacyPlayerIdBackfillCompatibility(databaseUrl) {
  const migration = readFileSync(playerIdPreparationMigrationPath, 'utf8');
  assert.match(
    migration,
    /add column if not exists player_id uuid default gen_random_uuid\(\)/i,
    'player_id preparation must materialize legacy IDs through ADD COLUMN DEFAULT',
  );
  assert.doesNotMatch(
    migration,
    /update\s+public\.game_players/i,
    'player_id preparation must not UPDATE legacy game_players rows',
  );

  execute(databaseUrl, `
    begin;

    create temporary table legacy_player_id_backfill_fixture (
      nick_key text primary key,
      nick text not null
    );

    insert into legacy_player_id_backfill_fixture(nick_key, nick)
    values ('ap', 'Ap');

    alter table legacy_player_id_backfill_fixture
      add constraint legacy_player_nickname_shape_check
      check (char_length(nick) between 3 and 24) not valid;

    alter table legacy_player_id_backfill_fixture
      add column player_id uuid default gen_random_uuid();

    alter table legacy_player_id_backfill_fixture
      alter column player_id set default gen_random_uuid(),
      alter column player_id set not null;

    do $fixture$
    begin
      if not exists (
        select 1
        from legacy_player_id_backfill_fixture
        where nick_key = 'ap'
          and nick = 'Ap'
          and player_id is not null
      ) then
        raise exception 'legacy player ID backfill did not preserve the historical nickname';
      end if;
    end;
    $fixture$;

    rollback;
  `);
}

const databaseUrl = readLocalEnvironment();

assertLegacyPlayerIdBackfillCompatibility(databaseUrl);

execute(databaseUrl, `
  drop table if exists public.player_achievement_highlights;
  delete from public.game_players where nick_key in ('${copyNickKey}', '${preserveNickKey}');

  insert into public.game_players (
    nick_key,
    nick,
    first_device_hash,
    first_ip_hash
  ) values
    ('${copyNickKey}', 'Migration Copy', 'migration-copy-device', 'migration-copy-ip'),
    ('${preserveNickKey}', 'Migration Preserve', 'migration-preserve-device', 'migration-preserve-ip');

  insert into public.game_player_achievements (
    nick_key,
    achievement_code,
    achievement_kind,
    title,
    description,
    points,
    achieved_on,
    metadata
  )
  select
    fixture.nick_key,
    achievement.code,
    'first_trophy',
    achievement.title,
    achievement.description,
    achievement.points,
    current_date,
    jsonb_build_object('fixture', true)
  from (values ('${copyNickKey}'), ('${preserveNickKey}')) as fixture(nick_key)
  cross join (values
    ('legacy_alpha', 'Legacy Alpha', 'First legacy achievement.', 10),
    ('legacy_beta', 'Legacy Beta', 'Second legacy achievement.', 20),
    ('legacy_gamma', 'Legacy Gamma', 'Third legacy achievement.', 30),
    ('legacy_delta', 'Legacy Delta', 'Fourth legacy achievement.', 40)
  ) as achievement(code, title, description, points);

  insert into public.game_player_featured_achievements (
    nick_key,
    achievement_code,
    position,
    active,
    selected_at,
    updated_at
  ) values (
    '${preserveNickKey}',
    'legacy_delta',
    1,
    true,
    clock_timestamp() - interval '1 day',
    clock_timestamp() - interval '1 day'
  );

  create table public.player_achievement_highlights (
    player_nick_key text not null references public.game_players(nick_key) on delete cascade,
    achievement_code text not null,
    position smallint not null,
    created_at timestamptz not null default timezone('utc'::text, now()),
    updated_at timestamptz not null default timezone('utc'::text, now()),
    constraint player_achievement_highlights_pkey primary key (player_nick_key, achievement_code),
    constraint player_achievement_highlights_position_check check (position >= 1 and position <= 3)
  );

  insert into public.player_achievement_highlights (
    player_nick_key,
    achievement_code,
    position,
    created_at,
    updated_at
  ) values
    ('${copyNickKey}', 'legacy_alpha', 3, clock_timestamp() - interval '4 minutes', clock_timestamp() - interval '4 minutes'),
    ('${copyNickKey}', 'legacy_beta', 1, clock_timestamp() - interval '3 minutes', clock_timestamp() - interval '3 minutes'),
    ('${copyNickKey}', 'legacy_gamma', 1, clock_timestamp() - interval '2 minutes', clock_timestamp() - interval '2 minutes'),
    ('${copyNickKey}', 'legacy_delta', 2, clock_timestamp() - interval '1 minute', clock_timestamp() - interval '1 minute'),
    ('${preserveNickKey}', 'legacy_alpha', 1, clock_timestamp() - interval '3 minutes', clock_timestamp() - interval '3 minutes'),
    ('${preserveNickKey}', 'legacy_beta', 2, clock_timestamp() - interval '2 minutes', clock_timestamp() - interval '2 minutes'),
    ('${preserveNickKey}', 'legacy_gamma', 3, clock_timestamp() - interval '1 minute', clock_timestamp() - interval '1 minute');
`);

applyCompatibilityMigration(databaseUrl);

const copied = JSON.parse(query(databaseUrl, `
  select json_build_object(
    'codes', coalesce(json_agg(selection.achievement_code order by selection.position), '[]'::json),
    'positions', coalesce(json_agg(selection.position order by selection.position), '[]'::json)
  )
  from public.game_player_featured_achievements selection
  where selection.nick_key = '${copyNickKey}'
    and selection.active = true;
`));
assert.deepEqual(copied.codes, ['legacy_beta', 'legacy_gamma', 'legacy_delta']);
assert.deepEqual(copied.positions, [1, 2, 3]);

const preserved = JSON.parse(query(databaseUrl, `
  select json_build_object(
    'codes', coalesce(json_agg(selection.achievement_code order by selection.position), '[]'::json),
    'positions', coalesce(json_agg(selection.position order by selection.position), '[]'::json)
  )
  from public.game_player_featured_achievements selection
  where selection.nick_key = '${preserveNickKey}'
    and selection.active = true;
`));
assert.deepEqual(preserved.codes, ['legacy_delta']);
assert.deepEqual(preserved.positions, [1]);

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

const copiedAgain = JSON.parse(query(databaseUrl, `
  select json_build_object(
    'codes', coalesce(json_agg(selection.achievement_code order by selection.position), '[]'::json),
    'positions', coalesce(json_agg(selection.position order by selection.position), '[]'::json)
  )
  from public.game_player_featured_achievements selection
  where selection.nick_key = '${copyNickKey}'
    and selection.active = true;
`));
assert.deepEqual(copiedAgain, copied);

const preservedAgain = JSON.parse(query(databaseUrl, `
  select json_build_object(
    'codes', coalesce(json_agg(selection.achievement_code order by selection.position), '[]'::json),
    'positions', coalesce(json_agg(selection.position order by selection.position), '[]'::json)
  )
  from public.game_player_featured_achievements selection
  where selection.nick_key = '${preserveNickKey}'
    and selection.active = true;
`));
assert.deepEqual(preservedAgain, preserved);

execute(databaseUrl, `
  drop table public.player_achievement_highlights;
  delete from public.game_players where nick_key in ('${copyNickKey}', '${preserveNickKey}');
`);

process.stdout.write('✓ Legacy player ID backfill and achievement-highlight upgrades are data-preserving and compatible\n');
