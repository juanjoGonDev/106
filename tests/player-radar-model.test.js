import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

import * as canonicalModel from '../shared/player-radar-model.js';
import * as edgeModel from '../supabase/functions/_shared/player-radar-model.js';
import {
  findPlayerRadarModelDrift,
  latestMigrationRevision,
  playerCardRendererRevision,
  renderBrowserPlayerRadarModel,
  renderConfigWithPlayerRadar,
  renderEdgePlayerRadarModel,
  renderMigrationAwareCanonicalModel,
  renderPlayerRadarHtml,
} from '../scripts/player-radar-model-files.mjs';

const canonicalSource = readFileSync('shared/player-radar-model.js', 'utf8');
const browserSource = readFileSync('public/player-radar-model.js', 'utf8');
const edgeSource = readFileSync('supabase/functions/_shared/player-radar-model.js', 'utf8');
const configSource = readFileSync('public/config.js', 'utf8');
const migrationRevision = latestMigrationRevision(readdirSync('supabase/migrations'));

function loadBrowserModel() {
  const context = vm.createContext({});
  vm.runInContext(browserSource, context, { filename: 'public/player-radar-model.js' });
  return context.Minuto106PlayerRadarModel;
}

const browserModel = loadBrowserModel();

const screenshotProfile = Object.freeze({
  bestDifferenceMs: 3,
  averageDifferenceMs: 351,
  attemptsUsed: 0,
  lifetimeAttemptsUsed: 5,
  verifiedAttempts: 5,
  completedReferrals: 0,
  bonusAttempts: 0,
});

const parityProfiles = Object.freeze([
  screenshotProfile,
  Object.freeze({
    bestDifferenceMs: 0,
    averageDifferenceMs: 0,
    lifetimeAttemptsUsed: 20,
    verifiedAttempts: 20,
    completedReferrals: 5,
    bonusAttempts: 0,
  }),
  Object.freeze({
    bestDifferenceMs: 999999,
    averageDifferenceMs: -500,
    attemptsUsed: 10,
    verifiedAttempts: 8,
    completedReferrals: 999,
    bonusAttempts: 999,
  }),
  Object.freeze({ attemptsUsed: 5, lifetimeAttemptsUsed: 0, verifiedAttempts: 0 }),
  Object.freeze({
    bestDifferenceMs: 'invalid',
    averageDifferenceMs: null,
    lifetimeAttemptsUsed: 'invalid',
    verifiedAttempts: -10,
    completedReferrals: -2,
    bonusAttempts: 'invalid',
  }),
]);

describe('canonical player radar model', () => {
  it('reproduces the deployed browser values from the reported screenshot', () => {
    expect(canonicalModel.buildPlayerRadarStats(screenshotProfile)).toEqual({
      precision: 100,
      consistency: 77,
      experience: 25,
      reliability: 100,
      impact: 0,
    });
    expect(canonicalModel.playerRadarStatsArray(screenshotProfile)).toEqual([100, 77, 25, 100, 0]);
  });

  it('keeps browser and Edge adapters behaviorally identical for every scoring boundary', () => {
    for (const profile of parityProfiles) {
      const expected = canonicalModel.buildPlayerRadarStats(profile);
      expect(browserModel.buildRadarStats(profile)).toEqual(expected);
      expect(edgeModel.buildPlayerRadarStats(profile)).toEqual(expected);
      expect(browserModel.buildRadarStatsArray(profile)).toEqual(canonicalModel.playerRadarStatsArray(profile));
      expect(edgeModel.playerRadarStatsArray(profile)).toEqual(canonicalModel.playerRadarStatsArray(profile));
    }
  });

  it('preserves legacy fallback without replacing an explicit lifetime zero', () => {
    expect(canonicalModel.resolveLifetimeAttemptsUsed({ attemptsUsed: 10, verifiedAttempts: 8 })).toBe(10);
    expect(canonicalModel.resolveLifetimeAttemptsUsed({ attemptsUsed: 10, lifetimeAttemptsUsed: 0 })).toBe(0);
    expect(canonicalModel.buildPlayerRadarStats({ attemptsUsed: 10, verifiedAttempts: 8 }).reliability).toBe(80);
    expect(canonicalModel.buildPlayerRadarStats({ attemptsUsed: 10, lifetimeAttemptsUsed: 0, verifiedAttempts: 8 }).reliability).toBe(0);
  });

  it('publishes one migration-aware immutable cache revision through every runtime', () => {
    expect(canonicalModel.PLAYER_CARD_RENDERER_REVISION).toBeGreaterThan(migrationRevision);
    expect(edgeModel.PLAYER_CARD_RENDERER_REVISION).toBe(canonicalModel.PLAYER_CARD_RENDERER_REVISION);
    expect(browserModel.cardRendererRevision).toBe(canonicalModel.PLAYER_CARD_RENDERER_REVISION);
    expect(playerCardRendererRevision(canonicalSource)).toBe(canonicalModel.PLAYER_CARD_RENDERER_REVISION);
    expect(Object.isFrozen(canonicalModel.PLAYER_RADAR_POLICY)).toBe(true);
    expect(Object.isFrozen(canonicalModel.PLAYER_RADAR_KEYS)).toBe(true);
  });
});

describe('generated player radar runtimes', () => {
  it('matches the canonical source and embedded production config exactly', () => {
    expect(browserSource).toBe(renderBrowserPlayerRadarModel(canonicalSource));
    expect(edgeSource).toBe(renderEdgePlayerRadarModel(canonicalSource));
    expect(configSource).toBe(renderConfigWithPlayerRadar(configSource, browserSource));
    expect(findPlayerRadarModelDrift({ canonicalSource, browserSource, edgeSource })).toEqual([]);
  });

  it('reports each independently drifted runtime', () => {
    expect(findPlayerRadarModelDrift({
      canonicalSource,
      browserSource: `${browserSource}\n// drift`,
      edgeSource,
    })).toEqual(['public/player-radar-model.js']);
    expect(findPlayerRadarModelDrift({
      canonicalSource,
      browserSource,
      edgeSource: `${edgeSource}\n// drift`,
    })).toEqual(['supabase/functions/_shared/player-radar-model.js']);
  });

  it('advances stale cache revisions after migrations without lowering manual renderer bumps', () => {
    const staleSource = canonicalSource.replace(
      /PLAYER_CARD_RENDERER_REVISION = \d+;/,
      `PLAYER_CARD_RENDERER_REVISION = ${migrationRevision};`,
    );
    const advancedSource = renderMigrationAwareCanonicalModel(staleSource, migrationRevision);
    expect(playerCardRendererRevision(advancedSource)).toBe(migrationRevision + 1);

    const manualRevision = migrationRevision + 50;
    const manualSource = canonicalSource.replace(
      /PLAYER_CARD_RENDERER_REVISION = \d+;/,
      `PLAYER_CARD_RENDERER_REVISION = ${manualRevision};`,
    );
    expect(renderMigrationAwareCanonicalModel(manualSource, migrationRevision)).toBe(manualSource);
  });

  it('rejects missing or invalid migration and renderer identities', () => {
    expect(() => latestMigrationRevision(['README.md'])).toThrow('No timestamped Supabase migrations were found.');
    expect(() => playerCardRendererRevision('export const PLAYER_CARD_RENDERER_REVISION = 0;')).toThrow('positive safe integer');
    expect(() => renderMigrationAwareCanonicalModel(canonicalSource, 0)).toThrow('latest migration revision');
  });

  it('embeds one generated runtime and replaces a previous generated section', () => {
    const baseConfig = 'window.__MINUTO106_CONFIG__ = { apiBaseUrl: "local" };\n';
    const first = renderConfigWithPlayerRadar(baseConfig, browserSource);
    expect(first).toBe(`${baseConfig.trimEnd()}\n${browserSource}`);
    expect(renderConfigWithPlayerRadar(first, browserSource)).toBe(first);
    expect(() => renderConfigWithPlayerRadar('window.other = {};', browserSource)).toThrow('must define window.__MINUTO106_CONFIG__');
  });

  it('loads one versioned config before every browser radar consumer', () => {
    const rendererRevision = canonicalModel.PLAYER_CARD_RENDERER_REVISION;
    const html = '<script src="./config.js"></script>\n<script src="./player-radar-model.js?v=old"></script>\n<script src="./player-ui.js"></script>\n<script src="./player-stats.js"></script>';
    const rendered = renderPlayerRadarHtml(html, rendererRevision);
    const expectedConfig = `<script src="./config.js?v=${rendererRevision}"></script>`;
    expect(rendered.match(/config\.js/g)).toHaveLength(1);
    expect(rendered).toContain(expectedConfig);
    expect(rendered).not.toContain('player-radar-model.js');
    expect(rendered.indexOf(expectedConfig)).toBeLessThan(rendered.indexOf('player-ui.js'));
    expect(rendered.indexOf(expectedConfig)).toBeLessThan(rendered.indexOf('player-stats.js'));
    expect(renderPlayerRadarHtml(rendered, rendererRevision)).toBe(rendered);
  });

  it('rejects invalid, missing, duplicated or late config scripts', () => {
    const revision = canonicalModel.PLAYER_CARD_RENDERER_REVISION;
    expect(() => renderPlayerRadarHtml('<script src="./config.js"></script>', 0)).toThrow('positive safe integer');
    expect(() => renderPlayerRadarHtml('<script src="./player-ui.js"></script>', revision)).toThrow('exactly once');
    expect(() => renderPlayerRadarHtml('<script src="./config.js"></script><script src="./config.js"></script>', revision)).toThrow('exactly once');
    expect(() => renderPlayerRadarHtml('<script src="./player-ui.js"></script><script src="./config.js"></script>', revision)).toThrow('must load before');
  });
});
