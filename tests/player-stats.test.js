import { beforeAll, describe, expect, it } from 'vitest';

beforeAll(async () => {
  globalThis.window = {};
  await import('../public/player-stats.js');
});

describe('player radar statistics', () => {
  it('awards maximum precision and consistency to a perfect player', () => {
    const stats = globalThis.window.Minuto106PlayerStats.buildRadarStats({
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
    const stats = globalThis.window.Minuto106PlayerStats.buildRadarStats({
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
    const stats = globalThis.window.Minuto106PlayerStats.buildRadarStats({
      attemptsUsed: 10,
      verifiedAttempts: 8,
    });
    expect(stats.reliability).toBe(80);
  });

  it('explains the reported low-impact profile and exact progression inputs', () => {
    expect(globalThis.window.Minuto106PlayerStats.impactExplanation({
      completedReferrals: 0,
      bonusAttempts: 1,
    })).toEqual({
      impact: 8,
      completedReferrals: 0,
      bonusAttempts: 1,
      copy: 'Impacto 8/100 · 0 referidos completados · +1 intento diario adicional. Cada referido completado suma 20 puntos y cada intento diario adicional suma 8.',
    });
  });

  it('uses singular referral copy and normalizes malformed negative values', () => {
    expect(globalThis.window.Minuto106PlayerStats.impactExplanation({
      completedReferrals: 1,
      bonusAttempts: 2,
    }).copy).toContain('1 referido completado · +2 intentos diarios adicionales');

    expect(globalThis.window.Minuto106PlayerStats.impactExplanation({
      completedReferrals: -10,
      bonusAttempts: 'invalid',
    })).toEqual({
      impact: 0,
      completedReferrals: 0,
      bonusAttempts: 0,
      copy: 'Impacto 0/100 · 0 referidos completados · +0 intentos diarios adicionales. Cada referido completado suma 20 puntos y cada intento diario adicional suma 8.',
    });
  });
});
