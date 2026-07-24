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
  return databaseUrl;
}

function query(databaseUrl, sql) {
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
  if (result.status !== 0) throw new Error(`psql failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

const databaseUrl = readLocalEnvironment();
const privileges = JSON.parse(query(databaseUrl, `
  select json_build_object(
    'securityDefiner', procedure.prosecdef,
    'anonExecute', has_function_privilege('anon', procedure.oid, 'EXECUTE'),
    'authenticatedExecute', has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
  )
  from pg_proc procedure
  join pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and procedure.proname = 'reward_referred_player'
    and pg_get_function_identity_arguments(procedure.oid) = '';
`));

assert.equal(privileges.securityDefiner, true);
assert.equal(privileges.anonExecute, false);
assert.equal(privileges.authenticatedExecute, false);

process.stdout.write('✓ reward_referred_player remains a trigger-only SECURITY DEFINER function with no Data API execution grants\n');
