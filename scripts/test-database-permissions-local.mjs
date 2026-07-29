import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

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
  return { databaseUrl, values };
}

function runPsql(databaseUrl, sql, expectSuccess = true) {
  const result = spawnSync('psql', [
    databaseUrl,
    '--no-psqlrc',
    '--tuples-only',
    '--no-align',
    '--set',
    'ON_ERROR_STOP=1',
    '--command',
    sql,
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if (expectSuccess && result.status !== 0) throw new Error(`psql failed: ${result.stderr || result.stdout}`);
  if (!expectSuccess && result.status === 0) throw new Error(`Expected psql to reject the statement: ${sql}`);
  return result.stdout.trim();
}

function query(databaseUrl, sql) {
  return runPsql(databaseUrl, sql, true);
}

function parseJson(databaseUrl, sql) {
  const value = query(databaseUrl, sql);
  return value ? JSON.parse(value) : null;
}

const requiredServiceFunctions = [
  'resolve_game_account_id',
  'resolve_game_account_token',
  'game_account_nick_keys',
  'get_game_account_merge_impact',
  'reconcile_game_player_identity_achievements',
  'refresh_game_player_progression_achievements_unfiltered',
  'refresh_game_player_progression_achievements',
  'merge_game_accounts_internal',
  'prepare_game_auth_link',
  'confirm_game_auth_merge',
  'cancel_game_auth_merge',
  'ensure_game_account_player',
  'get_game_account_players',
  'sync_game_league_trophies',
];

const { databaseUrl } = readLocalEnvironment();
const tablePrivileges = parseJson(databaseUrl, `
  select coalesce(json_agg(row_to_json(audit) order by audit.table_name), '[]'::json)
  from (
    select
      table_name,
      relation.relrowsecurity as row_security,
      has_table_privilege('anon', format('%I.%I', table_schema, table_name), 'SELECT,INSERT,UPDATE,DELETE') as anon_access,
      has_table_privilege('authenticated', format('%I.%I', table_schema, table_name), 'SELECT,INSERT,UPDATE,DELETE') as authenticated_access,
      has_table_privilege('service_role', format('%I.%I', table_schema, table_name), 'SELECT,INSERT,UPDATE,DELETE') as service_access
    from information_schema.tables information
    join pg_class relation on relation.relname = information.table_name
    join pg_namespace namespace on namespace.oid = relation.relnamespace and namespace.nspname = information.table_schema
    where table_schema = 'public'
      and table_type = 'BASE TABLE'
      and left(table_name, 5) = 'game_'
  ) audit;
`);

assert.ok(tablePrivileges.length >= 20, 'Expected the complete game schema to be installed.');
for (const table of tablePrivileges) {
  assert.equal(table.row_security, true, `${table.table_name} must keep RLS enabled.`);
  assert.equal(table.anon_access, false, `${table.table_name} must deny anon table access.`);
  assert.equal(table.authenticated_access, false, `${table.table_name} must deny authenticated table access.`);
  assert.equal(table.service_access, true, `${table.table_name} must remain available to service_role.`);
}
process.stdout.write(`✓ ${tablePrivileges.length} server-owned tables enforce RLS and deny anon/authenticated DML\n`);

const functionPrivileges = parseJson(databaseUrl, `
  select coalesce(json_agg(row_to_json(audit) order by audit.signature), '[]'::json)
  from (
    select
      procedure.proname as function_name,
      format('%I.%I(%s)', namespace.nspname, procedure.proname, pg_get_function_identity_arguments(procedure.oid)) as signature,
      procedure.prosecdef as security_definer,
      exists (
        select 1
        from aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) acl_entry
        where acl_entry.grantee = 0
          and acl_entry.privilege_type = 'EXECUTE'
      ) as public_execute,
      has_function_privilege('anon', procedure.oid, 'EXECUTE') as anon_execute,
      has_function_privilege('authenticated', procedure.oid, 'EXECUTE') as authenticated_execute,
      has_function_privilege('service_role', procedure.oid, 'EXECUTE') as service_execute
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and (
        left(procedure.proname, 5) = 'game_'
        or position('_game_' in procedure.proname) > 0
        or procedure.proname in (
          'ensure_game_account_player',
          'prepare_game_auth_link',
          'confirm_game_auth_merge',
          'cancel_game_auth_merge',
          'merge_game_accounts_internal',
          'resolve_game_account_id',
          'resolve_game_account_token',
          'reward_referred_player'
        )
      )
  ) audit;
`);

assert.ok(functionPrivileges.length >= 25, 'Expected private game functions to be installed.');
for (const procedure of functionPrivileges) {
  assert.equal(procedure.public_execute, false, `${procedure.signature} must revoke PUBLIC execution.`);
  assert.equal(procedure.anon_execute, false, `${procedure.signature} must deny anon execution.`);
  assert.equal(procedure.authenticated_execute, false, `${procedure.signature} must deny authenticated execution.`);
}

const proceduresByName = new Map(functionPrivileges.map((procedure) => [procedure.function_name, procedure]));
for (const functionName of requiredServiceFunctions) {
  const procedure = proceduresByName.get(functionName);
  assert.ok(procedure, `public.${functionName} must be installed.`);
  assert.equal(procedure.security_definer, true, `${procedure.signature} must remain SECURITY DEFINER.`);
  assert.equal(procedure.service_execute, true, `${procedure.signature} must remain executable by service_role.`);
}
process.stdout.write(`✓ ${functionPrivileges.length} private functions deny browser roles and preserve required definer RPCs\n`);

const sequencePrivileges = parseJson(databaseUrl, `
  select coalesce(json_agg(row_to_json(audit) order by audit.sequence_name), '[]'::json)
  from (
    select
      sequence_name,
      has_sequence_privilege('anon', format('%I.%I', sequence_schema, sequence_name), 'USAGE,SELECT,UPDATE') as anon_access,
      has_sequence_privilege('authenticated', format('%I.%I', sequence_schema, sequence_name), 'USAGE,SELECT,UPDATE') as authenticated_access
    from information_schema.sequences
    where sequence_schema = 'public'
      and left(sequence_name, 5) = 'game_'
  ) audit;
`);
for (const sequence of sequencePrivileges) {
  assert.equal(sequence.anon_access, false, `${sequence.sequence_name} must deny anon sequence access.`);
  assert.equal(sequence.authenticated_access, false, `${sequence.sequence_name} must deny authenticated sequence access.`);
}
process.stdout.write(`✓ ${sequencePrivileges.length} game sequences deny anon/authenticated access\n`);

for (const role of ['anon', 'authenticated']) {
  runPsql(databaseUrl, `begin; set local role ${role}; select * from public.game_accounts limit 1; rollback;`, false);
  runPsql(databaseUrl, `begin; set local role ${role}; select public.get_game_account_players('${'a'.repeat(64)}'); rollback;`, false);
  runPsql(databaseUrl, `begin; set local role ${role}; select public.prepare_game_auth_link(gen_random_uuid(), 'email', null, false, null, '${'b'.repeat(64)}'); rollback;`, false);
}
process.stdout.write('✓ runtime role probes confirm anon/authenticated cannot bypass the service boundary\n');
