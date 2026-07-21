import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const CONNECTION_TIMEOUT_SECONDS = '5';
const DIRECT_SUPABASE_PREFIX = 'db.';
const DIRECT_SUPABASE_SUFFIX = '.supabase.co';

export function analyzeSnapshotDatabaseUrl(value) {
  const candidate = String(value ?? '').trim();
  if (!candidate) {
    return {
      configured: false,
      valid: false,
      hostname: '',
      directSupabaseHost: false,
    };
  }

  let url;
  try {
    url = new URL(candidate);
  } catch {
    return {
      configured: true,
      valid: false,
      hostname: '',
      directSupabaseHost: false,
    };
  }

  const protocolValid = url.protocol === 'postgres:' || url.protocol === 'postgresql:';
  const hostname = url.hostname.toLowerCase();
  const directSupabaseHost = hostname.startsWith(DIRECT_SUPABASE_PREFIX)
    && hostname.endsWith(DIRECT_SUPABASE_SUFFIX);

  return {
    configured: true,
    valid: protocolValid && hostname.length > 0,
    hostname,
    directSupabaseHost,
  };
}

function warning(logger, message) {
  logger.error(`::warning::${message}`);
}

export function probeSnapshotDatabase({
  databaseUrl = process.env.SUPABASE_DB_URL,
  environment = process.env,
  spawn = spawnSync,
  logger = console,
} = {}) {
  const analysis = analyzeSnapshotDatabaseUrl(databaseUrl);

  if (!analysis.configured) {
    warning(logger, 'SUPABASE_DB_URL is not configured. Integrity snapshots will be skipped.');
    return { enabled: false, reason: 'missing', direct: false };
  }

  if (!analysis.valid) {
    warning(logger, 'SUPABASE_DB_URL is not a valid PostgreSQL connection URI. Integrity snapshots will be skipped.');
    return { enabled: false, reason: 'invalid', direct: false };
  }

  const result = spawn('psql', [
    '--no-psqlrc',
    '--tuples-only',
    '--no-align',
    '--set',
    'ON_ERROR_STOP=1',
    '--command',
    'select 1;',
  ], {
    encoding: 'utf8',
    env: {
      ...environment,
      PGCONNECT_TIMEOUT: CONNECTION_TIMEOUT_SECONDS,
      PGDATABASE: String(databaseUrl),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.status === 0) {
    logger.error(`Snapshot database connectivity verified for ${analysis.hostname}.`);
    return { enabled: true, reason: 'ok', direct: analysis.directSupabaseHost };
  }

  const recommendation = analysis.directSupabaseHost
    ? ' The direct Supabase host commonly requires IPv6; use the Session pooler URI on port 5432 for GitHub-hosted runners.'
    : ' Verify the Session pooler URI, encoded password and network access.';
  warning(
    logger,
    `Snapshot database ${analysis.hostname} is unreachable. Integrity snapshots will be skipped.${recommendation}`,
  );
  return { enabled: false, reason: 'unreachable', direct: analysis.directSupabaseHost };
}

function printGithubOutputs(result) {
  process.stdout.write(`enabled=${String(result.enabled)}\n`);
  process.stdout.write(`reason=${result.reason}\n`);
  process.stdout.write(`direct=${String(result.direct)}\n`);
}

const entryPoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === entryPoint) {
  printGithubOutputs(probeSnapshotDatabase());
}
