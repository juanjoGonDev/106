import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const migrationsDirectory = 'supabase/migrations';
const base = process.env.MIGRATION_DIFF_BASE?.trim();
const head = process.env.MIGRATION_DIFF_HEAD?.trim() || 'HEAD';
const zeroSha = /^0+$/;

function allMigrationFiles() {
  if (!existsSync(migrationsDirectory)) return [];
  return readdirSync(migrationsDirectory)
    .filter((file) => file.endsWith('.sql'))
    .map((file) => join(migrationsDirectory, file));
}

function changedMigrationFiles() {
  if (!base || zeroSha.test(base)) return allMigrationFiles();

  try {
    return execFileSync(
      'git',
      ['diff', '--name-only', '--diff-filter=AM', base, head, '--', `${migrationsDirectory}/*.sql`],
      { encoding: 'utf8' },
    )
      .split(/\r?\n/)
      .map((file) => file.trim())
      .filter(Boolean);
  } catch (error) {
    console.warn('Could not determine changed migrations; scanning all migrations instead.', error.message);
    return allMigrationFiles();
  }
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

const files = changedMigrationFiles();
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

if (violations.length > 0) {
  console.error('Potentially destructive production migration detected:');
  for (const violation of violations) console.error(`- ${violation}`);
  console.error('\nUse an additive migration instead. For an intentional reviewed operation, add:');
  console.error('-- production-data-loss-approved: <ticket/reason>');
  process.exit(1);
}

console.log(`Migration safety check passed for ${files.length} migration file(s).`);
