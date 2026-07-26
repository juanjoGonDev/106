import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const migrationsDirectory = 'supabase/migrations';
const zeroSha = /^0+$/;
const migrationVersionPattern = /^(\d{14})_/;

export function allMigrationFiles() {
  if (!existsSync(migrationsDirectory)) return [];
  return readdirSync(migrationsDirectory)
    .filter((file) => file.endsWith('.sql'))
    .map((file) => join(migrationsDirectory, file));
}

export function changedMigrationFiles({
  base = process.env.MIGRATION_DIFF_BASE?.trim(),
  head = process.env.MIGRATION_DIFF_HEAD?.trim() || 'HEAD',
  execute = execFileSync,
  logger = console,
} = {}) {
  if (!base || zeroSha.test(base)) return allMigrationFiles();

  try {
    return execute(
      'git',
      ['diff', '--name-only', '--diff-filter=AM', base, head, '--', `${migrationsDirectory}/*.sql`],
      { encoding: 'utf8' },
    )
      .split(/\r?\n/)
      .map((file) => file.trim())
      .filter(Boolean);
  } catch (error) {
    logger.warn('Could not determine changed migrations; scanning all migrations instead.', error.message);
    return allMigrationFiles();
  }
}

export function explicitMigrationFiles(selection, availableFiles = allMigrationFiles()) {
  const versions = String(selection ?? '')
    .split(',')
    .map((version) => version.trim())
    .filter(Boolean);

  const invalidVersions = versions.filter((version) => !/^\d{14}$/.test(version));
  if (invalidVersions.length) {
    throw new Error(`Invalid migration version selection: ${invalidVersions.join(', ')}`);
  }

  const filesByVersion = new Map();
  for (const file of availableFiles) {
    const version = basename(file).match(migrationVersionPattern)?.[1];
    if (!version) continue;
    const matches = filesByVersion.get(version) ?? [];
    matches.push(file);
    filesByVersion.set(version, matches);
  }

  return versions.map((version) => {
    const matches = filesByVersion.get(version) ?? [];
    if (matches.length !== 1) {
      throw new Error(
        `Expected exactly one local migration for ${version}; found ${matches.length}.`,
      );
    }
    return matches[0];
  });
}

export function selectedMigrationFiles() {
  if (Object.hasOwn(process.env, 'MIGRATION_VERSIONS')) {
    return explicitMigrationFiles(process.env.MIGRATION_VERSIONS);
  }
  return changedMigrationFiles();
}

const destructivePatterns = [
  { label: 'DROP TABLE', regex: /^\s*drop\s+table\b/im },
  { label: 'DROP SCHEMA', regex: /^\s*drop\s+schema\b/im },
  { label: 'TRUNCATE', regex: /^\s*truncate\b/im },
  { label: 'DELETE FROM', regex: /^\s*delete\s+from\b/im },
  { label: 'ALTER TABLE ... DROP', regex: /^\s*alter\s+table[\s\S]{0,250}?\bdrop\s+(?:column|constraint)\b/im },
  { label: 'DROP FUNCTION', regex: /^\s*drop\s+function\b/im },
  { label: 'DROP TYPE', regex: /^\s*drop\s+type\b/im },
];

function isVerifiedAchievementCheckExpansion(sql, pattern) {
  if (pattern.label !== 'ALTER TABLE ... DROP') return false;
  const normalized = sql.toLowerCase().replaceAll(/\s+/g, ' ').trim();
  const droppedCheck = [
    'alter table public.game_player_achievements',
    'drop constraint if exists game_player_achievements_achievement_kind_check;',
  ].join(' ');
  const recreatedCheck = [
    'alter table public.game_player_achievements',
    'add constraint game_player_achievements_achievement_kind_check',
    'check (achievement_kind in (',
  ].join(' ');

  return normalized.includes(droppedCheck)
    && normalized.includes(recreatedCheck)
    && !normalized.includes('drop column');
}

export function migrationViolations(files) {
  const violations = [];

  for (const file of files) {
    const sql = readFileSync(file, 'utf8');
    const explicitlyApproved = /--\s*production-data-loss-approved:\s*[^\s].+/i.test(sql);

    for (const pattern of destructivePatterns) {
      if (!pattern.regex.test(sql)) continue;
      if (explicitlyApproved || isVerifiedAchievementCheckExpansion(sql, pattern)) continue;
      violations.push(`${file}: ${pattern.label}`);
    }
  }

  return violations;
}

export function runProductionMigrationCheck({
  files = selectedMigrationFiles(),
  logger = console,
} = {}) {
  const violations = migrationViolations(files);
  if (violations.length > 0) {
    logger.error('Potentially destructive production migration detected:');
    for (const violation of violations) logger.error(`- ${violation}`);
    logger.error('\nUse an additive migration instead. For an intentional reviewed operation, add:');
    logger.error('-- production-data-loss-approved: <ticket/reason>');
    return false;
  }

  logger.log(`Migration safety check passed for ${files.length} migration file(s).`);
  return true;
}

const isMain = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMain) {
  try {
    if (!runProductionMigrationCheck()) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
