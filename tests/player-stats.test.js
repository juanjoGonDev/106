import { beforeAll, describe, expect, it } from 'vitest';

beforeAll(async () => {
  globalThis.window = {};
  await import('../public/player-stats.js');
});

describe('player radar statistics', () => {
  it('awards maximum precision and consistency to a perfect player', () => {
    const stats = window.Minuto106PlayerStats.buildRadarStats({
      bestDifferenceMs: 0,
      averageDifferenceMs: 0,
      attemptsUsed: 20,
      verifiedAttempts: 20,
      completedReferrals: 5,
      bonusAttempts: 0,
    });
    expect(stats).toEqual({
      precision: 100,
      consistency: 100,
      experience: 100,
      reliability: 100,
      impact: 100,
    });
  });

  it('clamps every attribute between zero and one hundred', () => {
    const stats = window.Minuto106PlayerStats.buildRadarStats({
      bestDifferenceMs: 999999,
      averageDifferenceMs: -500,
      attemptsUsed: 1,
      verifiedAttempts: 50,
      completedReferrals: 999,
      bonusAttempts: 999,
    });
    for (const value of Object.values(stats)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });

  it('uses verified ratio as the reliability score', () => {
    const stats = window.Minuto106PlayerStats.buildRadarStats({
      attemptsUsed: 10,
      verifiedAttempts: 8,
    });
    expect(stats.reliability).toBe(80);
  });
});