import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const PLAYER_RADAR_MODEL_PATHS = Object.freeze({
  canonical: resolve(repositoryRoot, 'shared/player-radar-model.js'),
  browser: resolve(repositoryRoot, 'public/player-radar-model.js'),
  edge: resolve(repositoryRoot, 'supabase/functions/_shared/player-radar-model.js'),
});

const GENERATED_BANNER = '// Generated from shared/player-radar-model.js. Run `pnpm sync:player-radar-model`; do not edit directly.\n';

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
  const canonicalSource = await readFile(PLAYER_RADAR_MODEL_PATHS.canonical, 'utf8');
  const expectedBrowser = renderBrowserPlayerRadarModel(canonicalSource);
  const expectedEdge = renderEdgePlayerRadarModel(canonicalSource);

  if (!check) {
    await Promise.all([
      writeFile(PLAYER_RADAR_MODEL_PATHS.browser, expectedBrowser),
      writeFile(PLAYER_RADAR_MODEL_PATHS.edge, expectedEdge),
    ]);
    return Object.freeze([]);
  }

  const [browserSource, edgeSource] = await Promise.all([
    readFile(PLAYER_RADAR_MODEL_PATHS.browser, 'utf8'),
    readFile(PLAYER_RADAR_MODEL_PATHS.edge, 'utf8'),
  ]);
  return findPlayerRadarModelDrift({ canonicalSource, browserSource, edgeSource });
}
