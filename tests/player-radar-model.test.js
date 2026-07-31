import { readFileSync } from 'node:fs';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

import * as canonicalModel from '../shared/player-radar-model.js';
import * as edgeModel from '../supabase/functions/_shared/player-radar-model.js';
import {
  findPlayerRadarModelDrift,
  renderBrowserPlayerRadarModel,
  renderEdgePlayerRadarModel,
} from '../scripts/player-radar-model-files.mjs';

const canonicalSource = readFileSync('shared/player-radar-model.js', 'utf8');
const browserSource = readFileSync('public/player-radar-model.js', 'utf8');
const edgeSource = readFileSync('supabase/functions/_shared/player-radar-model.js', 'utf8');

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

  it('publishes one immutable card-renderer revision through every runtime', () => {
    expect(canonicalModel.PLAYER_CARD_RENDERER_REVISION).toBe(2);
    expect(edgeModel.PLAYER_CARD_RENDERER_REVISION).toBe(2);
    expect(browserModel.cardRendererRevision).toBe(2);
    expect(Object.isFrozen(canonicalModel.PLAYER_RADAR_POLICY)).toBe(true);
    expect(Object.isFrozen(canonicalModel.PLAYER_RADAR_KEYS)).toBe(true);
  });
});

describe('generated player radar runtimes', () => {
  it('matches the canonical source exactly', () => {
    expect(browserSource).toBe(renderBrowserPlayerRadarModel(canonicalSource));
    expect(edgeSource).toBe(renderEdgePlayerRadarModel(canonicalSource));
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
});
