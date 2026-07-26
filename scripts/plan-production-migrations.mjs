import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const ANSI_ESCAPE = String.fromCodePoint(27);
const ANSI_CONTROL_SEQUENCE_INTRODUCER = '[';
const ANSI_FINAL_BYTE_MIN = 0x40;
const ANSI_FINAL_BYTE_MAX = 0x7e;
const MIGRATION_VERSION_PATTERN = /\b(\d{14})\b/;

function migrationVersion(cell) {
  return String(cell).match(MIGRATION_VERSION_PATTERN)?.[1] ?? null;
}

function ansiSequenceEnd(text, start) {
  for (let index = start; index < text.length; index += 1) {
    const codePoint = text.codePointAt(index);
    if (codePoint >= ANSI_FINAL_BYTE_MIN && codePoint <= ANSI_FINAL_BYTE_MAX) {
      return index;
    }
  }
  return -1;
}

export function stripAnsi(value) {
  const text = String(value ?? '');
  let normalized = '';

  for (let index = 0; index < text.length; index += 1) {
    const isControlSequence = text[index] === ANSI_ESCAPE
      && text[index + 1] === ANSI_CONTROL_SEQUENCE_INTRODUCER;
    if (!isControlSequence) {
      normalized += text[index];
      continue;
    }

    const end = ansiSequenceEnd(text, index + 2);
    if (end < 0) {
      normalized += text[index];
      continue;
    }
    index = end;
  }

  return normalized;
}

export function parseMigrationList(output) {
  const rows = [];
  const normalized = stripAnsi(output);

  for (const line of normalized.split(/\r?\n/)) {
    const delimiter = line.includes('│') ? '│' : line.includes('|') ? '|' : null;
    if (!delimiter) continue;

    const cells = line.split(delimiter);
    if (cells.length < 2) continue;

    const local = migrationVersion(cells[0]);
    const remote = migrationVersion(cells[1]);
    if (!local && !remote) continue;
    rows.push({ local, remote });
  }

  if (!rows.length) {
    throw new Error('Could not parse any migration versions from `supabase migration list`.');
  }

  return rows;
}

function sortedUnique(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

export function buildMigrationPlan(rows) {
  const localVersions = sortedUnique(rows.map((row) => row.local));
  const remoteVersions = sortedUnique(rows.map((row) => row.remote));
  const localSet = new Set(localVersions);
  const remoteSet = new Set(remoteVersions);
  const remoteOnlyVersions = remoteVersions.filter((version) => !localSet.has(version));

  if (remoteOnlyVersions.length) {
    throw new Error(
      `Remote migration history contains versions missing locally: ${remoteOnlyVersions.join(', ')}. `
      + 'Refuse to deploy until history and repository migrations are reconciled.',
    );
  }

  const pendingVersions = localVersions.filter((version) => !remoteSet.has(version));
  const maxRemoteVersion = remoteVersions.at(-1) ?? null;
  const outOfOrderVersions = maxRemoteVersion
    ? pendingVersions.filter((version) => version < maxRemoteVersion)
    : [];

  return {
    includeAll: outOfOrderVersions.length > 0,
    localVersions,
    remoteVersions,
    pendingVersions,
    outOfOrderVersions,
    maxRemoteVersion,
  };
}

export function formatGitHubOutputs(plan) {
  return [
    `include_all=${plan.includeAll}`,
    `pending_count=${plan.pendingVersions.length}`,
    `pending_versions=${plan.pendingVersions.join(',')}`,
    `out_of_order_versions=${plan.outOfOrderVersions.join(',')}`,
    `max_remote_version=${plan.maxRemoteVersion ?? ''}`,
  ].join('\n');
}

function reportPlan(plan, logger = console) {
  logger.error(`Pending production migrations: ${plan.pendingVersions.length}.`);
  if (!plan.includeAll) {
    logger.error('Migration order is linear; standard `db push` mode is sufficient.');
    return;
  }

  logger.error(
    'Out-of-order pending migrations detected; `--include-all` is required for: '
    + plan.outOfOrderVersions.join(', '),
  );
}

export function runMigrationPlanner({
  args = process.argv.slice(2),
  readFile = readFileSync,
  stdout = process.stdout,
  logger = console,
} = {}) {
  const [statusPath] = args;
  if (!statusPath) {
    throw new Error('Usage: node scripts/plan-production-migrations.mjs <migration-status-file>');
  }

  const rows = parseMigrationList(readFile(statusPath, 'utf8'));
  const plan = buildMigrationPlan(rows);
  reportPlan(plan, logger);
  stdout.write(`${formatGitHubOutputs(plan)}\n`);
  return plan;
}

const isMain = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMain) {
  try {
    runMigrationPlanner();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
