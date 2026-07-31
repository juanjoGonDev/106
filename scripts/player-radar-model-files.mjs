import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrationFilePattern = /^(\d{14})_[a-z0-9][a-z0-9_]*\.sql$/;
const rendererRevisionPattern = /^export const PLAYER_CARD_RENDERER_REVISION = (\d+);$/m;
const playerRadarScriptPattern = /<script src="\.\/player-radar-model\.js(?:\?[^\"]*)?"><\/script>\s*/g;
const configScriptPattern = /<script src="\.\/config\.js(?:\?[^\"]*)?"><\/script>/g;
const playerConsumerScriptPattern = /<script src="\.\/(?:player-ui|player-stats)\.js(?:\?[^\"]*)?"><\/script>/;

export const PLAYER_RADAR_MODEL_PATHS = Object.freeze({
  canonical: resolve(repositoryRoot, 'shared/player-radar-model.js'),
  browser: resolve(repositoryRoot, 'public/player-radar-model.js'),
  edge: resolve(repositoryRoot, 'supabase/functions/_shared/player-radar-model.js'),
  config: resolve(repositoryRoot, 'public/config.js'),
  migrations: resolve(repositoryRoot, 'supabase/migrations'),
  publicDirectory: resolve(repositoryRoot, 'public'),
});

const GENERATED_BANNER = '// Generated from shared/player-radar-model.js. Run `node scripts/sync-player-radar-model.mjs`; do not edit directly.\n';

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

  const sourceWithoutDirectModel = String(htmlSource).replace(playerRadarScriptPattern, '');
  let configScriptCount = 0;
  const rendered = sourceWithoutDirectModel.replace(configScriptPattern, () => {
    configScriptCount += 1;
    return `<script src="./config.js?v=${revision}"></script>`;
  });
  if (configScriptCount !== 1) {
    throw new Error('Each radar consumer document must load config.js exactly once.');
  }

  const consumer = rendered.match(playerConsumerScriptPattern);
  const configIndex = rendered.indexOf(`./config.js?v=${revision}`);
  if (consumer?.index !== undefined && configIndex > consumer.index) {
    throw new Error('config.js must load before player radar consumers.');
  }
  return rendered;
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
