import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrationFilePattern = /^(\d{14})_[a-z0-9][a-z0-9_]*\.sql$/;
const rendererRevisionPattern = /^export const PLAYER_CARD_RENDERER_REVISION = (\d+);$/m;
const playerRadarScriptPattern = /<script src="\.\/player-radar-model\.js(?:\?[^\"]*)?"><\/script>\s*/g;
const playerDependencyScriptPattern = /<script src="\.\/(?:player-ui|player-stats)\.js(?:\?[^\"]*)?"><\/script>/;

export const PLAYER_RADAR_MODEL_PATHS = Object.freeze({
  canonical: resolve(repositoryRoot, 'shared/player-radar-model.js'),
  browser: resolve(repositoryRoot, 'public/player-radar-model.js'),
  edge: resolve(repositoryRoot, 'supabase/functions/_shared/player-radar-model.js'),
  migrations: resolve(repositoryRoot, 'supabase/migrations'),
  html: Object.freeze({
    'public/index.html': resolve(repositoryRoot, 'public/index.html'),
    'public/player.html': resolve(repositoryRoot, 'public/player.html'),
  }),
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

  const sourceWithoutModel = String(htmlSource).replace(playerRadarScriptPattern, '');
  const dependency = sourceWithoutModel.match(playerDependencyScriptPattern);
  if (!dependency || dependency.index === undefined) {
    throw new Error('Player radar HTML must load player-ui.js or player-stats.js.');
  }

  const dependencyIndex = dependency.index;
  const lineStart = sourceWithoutModel.lastIndexOf('\n', dependencyIndex - 1) + 1;
  const linePrefix = sourceWithoutModel.slice(lineStart, dependencyIndex);
  const separator = /^\s*$/.test(linePrefix) ? `\n${linePrefix}` : '';
  const modelScript = `<script src="./player-radar-model.js?v=${revision}"></script>`;

  return `${sourceWithoutModel.slice(0, dependencyIndex)}${modelScript}${separator}${sourceWithoutModel.slice(dependencyIndex)}`;
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

export function findPlayerRadarModelDrift({ canonicalSource, browserSource, edgeSource }) {
  const expectedBrowser = renderBrowserPlayerRadarModel(canonicalSource);
  const expectedEdge = renderEdgePlayerRadarModel(canonicalSource);
  return Object.freeze([
    browserSource === expectedBrowser ? null : 'public/player-radar-model.js',
    edgeSource === expectedEdge ? null : 'supabase/functions/_shared/player-radar-model.js',
  ].filter(Boolean));
}

export async function synchronizePlayerRadarModels({ check = false } = {}) {
  const [canonicalSource, migrationFiles, ...htmlSources] = await Promise.all([
    readFile(PLAYER_RADAR_MODEL_PATHS.canonical, 'utf8'),
    readdir(PLAYER_RADAR_MODEL_PATHS.migrations),
    ...Object.values(PLAYER_RADAR_MODEL_PATHS.html).map((path) => readFile(path, 'utf8')),
  ]);
  const migrationRevision = latestMigrationRevision(migrationFiles);
  const expectedCanonical = renderMigrationAwareCanonicalModel(canonicalSource, migrationRevision);
  const rendererRevision = playerCardRendererRevision(expectedCanonical);
  const expectedBrowser = renderBrowserPlayerRadarModel(expectedCanonical);
  const expectedEdge = renderEdgePlayerRadarModel(expectedCanonical);
  const htmlEntries = Object.entries(PLAYER_RADAR_MODEL_PATHS.html);
  const expectedHtml = htmlSources.map((source) => renderPlayerRadarHtml(source, rendererRevision));

  if (!check) {
    await Promise.all([
      writeFile(PLAYER_RADAR_MODEL_PATHS.canonical, expectedCanonical),
      writeFile(PLAYER_RADAR_MODEL_PATHS.browser, expectedBrowser),
      writeFile(PLAYER_RADAR_MODEL_PATHS.edge, expectedEdge),
      ...htmlEntries.map(([, path], index) => writeFile(path, expectedHtml[index])),
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
    ...htmlEntries.map(([repositoryPath], index) => (
      htmlSources[index] === expectedHtml[index] ? null : repositoryPath
    )),
  ].filter(Boolean);

  return Object.freeze(drift);
}
