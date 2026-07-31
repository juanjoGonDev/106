import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrationFilePattern = /^(\d{14})_[a-z0-9][a-z0-9_]*\.sql$/;
const rendererRevisionPattern = /^export const PLAYER_CARD_RENDERER_REVISION = (\d+);$/m;
const playerRadarScriptPrefix = '<script src="./player-radar-model.js';
const configScriptPrefix = '<script src="./config.js';
const playerConsumerScriptPrefixes = Object.freeze([
  '<script src="./player-ui.js',
  '<script src="./player-stats.js',
]);
const scriptClosingTag = '</script>';

export const PLAYER_RADAR_MODEL_PATHS = Object.freeze({
  canonical: resolve(repositoryRoot, 'shared/player-radar-model.js'),
  browser: resolve(repositoryRoot, 'public/player-radar-model.js'),
  edge: resolve(repositoryRoot, 'supabase/functions/_shared/player-radar-model.js'),
  config: resolve(repositoryRoot, 'public/config.js'),
  migrations: resolve(repositoryRoot, 'supabase/migrations'),
  publicDirectory: resolve(repositoryRoot, 'public'),
});

const GENERATED_BANNER = '// Generated from shared/player-radar-model.js. Run `node scripts/sync-player-radar-model.mjs`; do not edit directly.\n';

function scriptEndIndex(source, startIndex) {
  const closingIndex = source.indexOf(scriptClosingTag, startIndex);
  return closingIndex < 0 ? -1 : closingIndex + scriptClosingTag.length;
}

function isHtmlWhitespace(character) {
  return character === ' ' || character === '\n' || character === '\r' || character === '\t';
}

function removeScriptsByPrefix(source, prefix) {
  let rendered = '';
  let cursor = 0;
  let count = 0;

  while (cursor < source.length) {
    const startIndex = source.indexOf(prefix, cursor);
    if (startIndex < 0) {
      rendered += source.slice(cursor);
      break;
    }
    const endIndex = scriptEndIndex(source, startIndex);
    if (endIndex < 0) {
      rendered += source.slice(cursor);
      break;
    }

    rendered += source.slice(cursor, startIndex);
    cursor = endIndex;
    while (cursor < source.length && isHtmlWhitespace(source[cursor])) cursor += 1;
    count += 1;
  }

  return Object.freeze({ source: rendered, count });
}

function replaceScriptsByPrefix(source, prefix, replacement) {
  let rendered = '';
  let cursor = 0;
  let count = 0;

  while (cursor < source.length) {
    const startIndex = source.indexOf(prefix, cursor);
    if (startIndex < 0) {
      rendered += source.slice(cursor);
      break;
    }
    const endIndex = scriptEndIndex(source, startIndex);
    if (endIndex < 0) {
      rendered += source.slice(cursor);
      break;
    }

    rendered += source.slice(cursor, startIndex);
    rendered += replacement;
    cursor = endIndex;
    count += 1;
  }

  return Object.freeze({ source: rendered, count });
}

function firstPlayerConsumerIndex(source) {
  const indexes = playerConsumerScriptPrefixes
    .map((prefix) => source.indexOf(prefix))
    .filter((index) => index >= 0);
  return indexes.length > 0 ? Math.min(...indexes) : -1;
}

export function latestMigrationRevision(fileNames) {
  const revisions = Array.from(fileNames ?? [], (fileName) => {
    const match = String(fileName).match(migrationFilePattern);
    return match ? Number(match[1]) : 0;
  }).filter((revision) => Number.isSafeInteger(revision) && revision > 0);

  if (revisions.length === 0) {
    throw new Error('No timestamped Supabase migrations were found.');
  }
  return Math.max(...revisions);
}

export function playerCardRendererRevision(canonicalSource) {
  const match = String(canonicalSource).match(rendererRevisionPattern);
  const revision = Number(match?.[1]);
  if (!Number.isSafeInteger(revision) || revision <= 0) {
    throw new Error('PLAYER_CARD_RENDERER_REVISION must be a positive safe integer.');
  }
  return revision;
}

export function renderMigrationAwareCanonicalModel(canonicalSource, migrationRevision) {
  const source = String(canonicalSource);
  const currentRevision = playerCardRendererRevision(source);
  const normalizedMigrationRevision = Number(migrationRevision);
  if (!Number.isSafeInteger(normalizedMigrationRevision) || normalizedMigrationRevision <= 0) {
    throw new Error('The latest migration revision must be a positive safe integer.');
  }
  if (currentRevision > normalizedMigrationRevision) return source;
  return source.replace(
    rendererRevisionPattern,
    `export const PLAYER_CARD_RENDERER_REVISION = ${normalizedMigrationRevision + 1};`,
  );
}

export function renderPlayerRadarHtml(htmlSource, rendererRevision) {
  const revision = Number(rendererRevision);
  if (!Number.isSafeInteger(revision) || revision <= 0) {
    throw new Error('The player radar HTML revision must be a positive safe integer.');
  }

  const sourceWithoutDirectModel = removeScriptsByPrefix(
    String(htmlSource),
    playerRadarScriptPrefix,
  ).source;
  const expectedConfigScript = `<script src="./config.js?v=${revision}"></script>`;
  const configScripts = replaceScriptsByPrefix(
    sourceWithoutDirectModel,
    configScriptPrefix,
    expectedConfigScript,
  );
  if (configScripts.count !== 1) {
    throw new Error('Each radar consumer document must load config.js exactly once.');
  }

  const consumerIndex = firstPlayerConsumerIndex(configScripts.source);
  const configIndex = configScripts.source.indexOf(expectedConfigScript);
  if (consumerIndex >= 0 && configIndex > consumerIndex) {
    throw new Error('config.js must load before player radar consumers.');
  }
  return configScripts.source;
}

export function renderBrowserPlayerRadarModel(canonicalSource) {
  const runtimeSource = String(canonicalSource).replace(/^export /gm, '');
  const indented = runtimeSource
    .trimEnd()
    .split('\n')
    .map((line) => line ? `  ${line}` : '')
    .join('\n');

  return `${GENERATED_BANNER}(() => {\n${indented}\n\n  globalThis.Minuto106PlayerRadarModel = Object.freeze({\n    cardRendererRevision: PLAYER_CARD_RENDERER_REVISION,\n    keys: PLAYER_RADAR_KEYS,\n    policy: PLAYER_RADAR_POLICY,\n    buildRadarStats: buildPlayerRadarStats,\n    buildRadarStatsArray: playerRadarStatsArray,\n    resolveLifetimeAttemptsUsed,\n  });\n})();\n`;
}

export function renderEdgePlayerRadarModel(canonicalSource) {
  return `${GENERATED_BANNER}${String(canonicalSource).trimEnd()}\n`;
}

export function renderConfigWithPlayerRadar(configSource, browserSource) {
  const source = String(configSource);
  const generatedRuntimeIndex = source.indexOf(GENERATED_BANNER);
  const configPrefix = (generatedRuntimeIndex >= 0 ? source.slice(0, generatedRuntimeIndex) : source).trimEnd();
  if (!configPrefix.includes('window.__MINUTO106_CONFIG__')) {
    throw new Error('public/config.js must define window.__MINUTO106_CONFIG__.');
  }
  return `${configPrefix}\n${String(browserSource).trimStart()}`;
}

export function findPlayerRadarModelDrift({ canonicalSource, browserSource, edgeSource }) {
  const expectedBrowser = renderBrowserPlayerRadarModel(canonicalSource);
  const expectedEdge = renderEdgePlayerRadarModel(canonicalSource);
  return Object.freeze([
    browserSource === expectedBrowser ? null : 'public/player-radar-model.js',
    edgeSource === expectedEdge ? null : 'supabase/functions/_shared/player-radar-model.js',
  ].filter(Boolean));
}

async function readConfigHtmlEntries() {
  const directoryEntries = await readdir(PLAYER_RADAR_MODEL_PATHS.publicDirectory, { withFileTypes: true });
  const htmlFiles = directoryEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.html'))
    .map((entry) => entry.name)
    .sort();
  const sources = await Promise.all(htmlFiles.map((fileName) => (
    readFile(resolve(PLAYER_RADAR_MODEL_PATHS.publicDirectory, fileName), 'utf8')
  )));
  return htmlFiles
    .map((fileName, index) => ({
      repositoryPath: `public/${fileName}`,
      filePath: resolve(PLAYER_RADAR_MODEL_PATHS.publicDirectory, fileName),
      source: sources[index],
    }))
    .filter((entry) => (
      entry.source.includes('./config.js')
      && (entry.source.includes('./player-ui.js') || entry.source.includes('./player-stats.js'))
    ));
}

export async function synchronizePlayerRadarModels({ check = false } = {}) {
  const [canonicalSource, migrationFiles, configSource, htmlEntries] = await Promise.all([
    readFile(PLAYER_RADAR_MODEL_PATHS.canonical, 'utf8'),
    readdir(PLAYER_RADAR_MODEL_PATHS.migrations),
    readFile(PLAYER_RADAR_MODEL_PATHS.config, 'utf8'),
    readConfigHtmlEntries(),
  ]);
  const migrationRevision = latestMigrationRevision(migrationFiles);
  const expectedCanonical = renderMigrationAwareCanonicalModel(canonicalSource, migrationRevision);
  const rendererRevision = playerCardRendererRevision(expectedCanonical);
  const expectedBrowser = renderBrowserPlayerRadarModel(expectedCanonical);
  const expectedEdge = renderEdgePlayerRadarModel(expectedCanonical);
  const expectedConfig = renderConfigWithPlayerRadar(configSource, expectedBrowser);
  const expectedHtml = htmlEntries.map((entry) => renderPlayerRadarHtml(entry.source, rendererRevision));

  if (!check) {
    await Promise.all([
      writeFile(PLAYER_RADAR_MODEL_PATHS.canonical, expectedCanonical),
      writeFile(PLAYER_RADAR_MODEL_PATHS.browser, expectedBrowser),
      writeFile(PLAYER_RADAR_MODEL_PATHS.edge, expectedEdge),
      writeFile(PLAYER_RADAR_MODEL_PATHS.config, expectedConfig),
      ...htmlEntries.map((entry, index) => writeFile(entry.filePath, expectedHtml[index])),
    ]);
    return Object.freeze([]);
  }

  const [browserSource, edgeSource] = await Promise.all([
    readFile(PLAYER_RADAR_MODEL_PATHS.browser, 'utf8'),
    readFile(PLAYER_RADAR_MODEL_PATHS.edge, 'utf8'),
  ]);
  const drift = [
    canonicalSource === expectedCanonical ? null : 'shared/player-radar-model.js',
    ...findPlayerRadarModelDrift({
      canonicalSource: expectedCanonical,
      browserSource,
      edgeSource,
    }),
    configSource === expectedConfig ? null : 'public/config.js',
    ...htmlEntries.map((entry, index) => (
      entry.source === expectedHtml[index] ? null : entry.repositoryPath
    )),
  ].filter(Boolean);

  return Object.freeze(drift);
}
