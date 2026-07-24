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

function isVerifiedCheckConstraintExpansion(sql, pattern) {
  if (pattern.label !== 'ALTER TABLE ... DROP') return false;
  const replacements = [...sql.matchAll(
    /alter\s+table\s+([\w.]+)\s+drop\s+constraint\s+(?:if\s+exists\s+)?([\w"]+)\s*;/gim,
  )];
  if (replacements.length === 0 || /\bdrop\s+column\b/i.test(sql)) return false;

  return replacements.every(([, table, rawConstraint]) => {
    const constraint = rawConstraint.replaceAll('"', '');
    const normalizedTable = table.replaceAll('"', '');
    const escapedTable = normalizedTable.replaceAll('.', '\\.');
    const escapedConstraint = constraint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const recreated = new RegExp(
      `alter\\s+table\\s+${escapedTable}\\s+add\\s+constraint\\s+"?${escapedConstraint}"?\\s+check\\s*\\(`,
      'i',
    );
    return recreated.test(sql);
  });
}

const files = changedMigrationFiles();
const violations = [];

for (const file of files) {
  const sql = readFileSync(file, 'utf8');
  const explicitlyApproved = /--\s*production-data-loss-approved:\s*[^\s].+/i.test(sql);

  for (const pattern of destructivePatterns) {
    if (!pattern.regex.test(sql)) continue;
    if (explicitlyApproved || isVerifiedCheckConstraintExpansion(sql, pattern)) continue;
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
