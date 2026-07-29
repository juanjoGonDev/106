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

function isIdentifierCharacter(character) {
  if (!character) return false;
  const code = character.codePointAt(0);
  return (code >= 48 && code <= 57)
    || (code >= 65 && code <= 90)
    || code === 95
    || (code >= 97 && code <= 122);
}

function isWhitespaceCharacter(character) {
  if (!character) return false;
  return character === ' '
    || character === '\t'
    || character === '\n'
    || character === '\r'
    || character === '\f'
    || character === '\v';
}

function isKeywordAt(source, lowerSource, index, keyword) {
  if (lowerSource.slice(index, index + keyword.length) !== keyword) return false;
  return !isIdentifierCharacter(source[index - 1])
    && !isIdentifierCharacter(source[index + keyword.length]);
}

function skipWhitespace(source, index) {
  let cursor = index;
  while (cursor < source.length && isWhitespaceCharacter(source[cursor])) cursor += 1;
  return cursor;
}

function keywordEnd(source, lowerSource, index, keyword) {
  return isKeywordAt(source, lowerSource, index, keyword)
    ? index + keyword.length
    : -1;
}

function functionDeclarationEnd(source, lowerSource, createIndex) {
  let cursor = keywordEnd(source, lowerSource, createIndex, 'create');
  if (cursor < 0) return -1;
  cursor = skipWhitespace(source, cursor);

  const directFunctionEnd = keywordEnd(source, lowerSource, cursor, 'function');
  if (directFunctionEnd >= 0) return directFunctionEnd;

  cursor = keywordEnd(source, lowerSource, cursor, 'or');
  if (cursor < 0) return -1;
  cursor = skipWhitespace(source, cursor);
  cursor = keywordEnd(source, lowerSource, cursor, 'replace');
  if (cursor < 0) return -1;
  cursor = skipWhitespace(source, cursor);
  return keywordEnd(source, lowerSource, cursor, 'function');
}

function findNextFunctionStart(source, lowerSource, fromIndex) {
  let searchIndex = fromIndex;
  while (searchIndex < source.length) {
    const createIndex = lowerSource.indexOf('create', searchIndex);
    if (createIndex < 0) return -1;
    if (functionDeclarationEnd(source, lowerSource, createIndex) >= 0) return createIndex;
    searchIndex = createIndex + 'create'.length;
  }
  return -1;
}

function isDollarTag(value) {
  for (const character of value) {
    if (!isIdentifierCharacter(character)) return false;
  }
  return true;
}

function findFunctionBody(source, lowerSource, startIndex) {
  let searchIndex = startIndex;
  while (searchIndex < source.length) {
    const asIndex = lowerSource.indexOf('as', searchIndex);
    if (asIndex < 0) return null;
    if (!isKeywordAt(source, lowerSource, asIndex, 'as')) {
      searchIndex = asIndex + 2;
      continue;
    }

    const delimiterStart = skipWhitespace(source, asIndex + 2);
    if (source[delimiterStart] !== '$') {
      searchIndex = asIndex + 2;
      continue;
    }
    const delimiterEnd = source.indexOf('$', delimiterStart + 1);
    if (delimiterEnd < 0) return null;
    const tag = source.slice(delimiterStart + 1, delimiterEnd);
    if (!isDollarTag(tag)) {
      searchIndex = delimiterEnd + 1;
      continue;
    }

    const delimiter = source.slice(delimiterStart, delimiterEnd + 1);
    const openingEnd = delimiterEnd + 1;
    const closingStart = source.indexOf(delimiter, openingEnd);
    if (closingStart < 0) return null;
    return { delimiter, openingEnd, closingStart };
  }
  return null;
}

export function migrationExecutionSql(sql) {
  const source = String(sql ?? '');
  const lowerSource = source.toLowerCase();
  let cursor = 0;
  let output = '';
  let functionStart = findNextFunctionStart(source, lowerSource, cursor);

  while (functionStart >= 0) {
    output += source.slice(cursor, functionStart);
    const body = findFunctionBody(source, lowerSource, functionStart);
    if (!body) return output + source.slice(functionStart);

    output += source.slice(functionStart, body.openingEnd);
    output += '/* runtime function body omitted by deployment guard */';
    output += body.delimiter;
    cursor = body.closingStart + body.delimiter.length;
    functionStart = findNextFunctionStart(source, lowerSource, cursor);
  }

  return output + source.slice(cursor);
}

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
    const executionSql = migrationExecutionSql(sql);
    const explicitlyApproved = /--\s*production-data-loss-approved:\s*[^\s].+/i.test(sql);

    for (const pattern of destructivePatterns) {
      if (!pattern.regex.test(executionSql)) continue;
      if (explicitlyApproved || isVerifiedAchievementCheckExpansion(executionSql, pattern)) continue;
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
