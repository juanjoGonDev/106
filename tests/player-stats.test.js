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
      attemptsUsed: 0,
      lifetimeAttemptsUsed: 20,
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
      attemptsUsed: 0,
      lifetimeAttemptsUsed: 1,
      verifiedAttempts: 50,
      completedReferrals: 999,
      bonusAttempts: 999,
    });
    for (const value of Object.values(stats)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });

  it('uses lifetime attempts instead of current-day usage for reliability after reset', () => {
    const stats = globalThis.window.Minuto106PlayerStats.buildRadarStats({
      attemptsUsed: 0,
      lifetimeAttemptsUsed: 10,
      verifiedAttempts: 8,
    });
    expect(stats.reliability).toBe(80);
  });

  it('keeps rolling compatibility with profiles that do not expose lifetime attempts yet', () => {
    const stats = globalThis.window.Minuto106PlayerStats.buildRadarStats({
      attemptsUsed: 10,
      verifiedAttempts: 8,
    });
    expect(stats.reliability).toBe(80);
  });

  it('does not replace an explicit zero lifetime total with current-day usage', () => {
    const stats = globalThis.window.Minuto106PlayerStats.buildRadarStats({
      attemptsUsed: 5,
      lifetimeAttemptsUsed: 0,
      verifiedAttempts: 0,
    });
    expect(stats.reliability).toBe(0);
  });

  it('builds one actionable explanation for every radar statistic from the shared scoring policy', () => {
    const explanations = globalThis.window.Minuto106PlayerStats.statExplanations({
      bestDifferenceMs: 4,
      averageDifferenceMs: 250,
      attemptsUsed: 0,
      lifetimeAttemptsUsed: 17,
      verifiedAttempts: 17,
      completedReferrals: 0,
      bonusAttempts: 1,
    });

    expect(explanations.map(({ key, label, score }) => ({ key, label, score }))).toEqual([
      { key: 'precision', label: 'Precisión', score: 100 },
      { key: 'consistency', label: 'Regularidad', score: 83 },
      { key: 'experience', label: 'Experiencia', score: 85 },
      { key: 'reliability', label: 'Fiabilidad', score: 100 },
      { key: 'impact', label: 'Impacto', score: 8 },
    ]);
    expect(explanations[0]).toMatchObject({
      current: 'Tu mejor diferencia actual es ±4 ms.',
      calculation: 'Parte de 100/100 con 0 ms de diferencia y baja de forma lineal hasta 0/100 con 1000 ms o más.',
    });
    expect(explanations[1].calculation).toContain('1500 ms o más');
    expect(explanations[2]).toMatchObject({
      current: 'Tienes 17 intentos válidos.',
      calculation: 'Cada intento válido aporta 5 puntos. Alcanzas 100/100 con 20 intentos válidos.',
    });
    expect(explanations[3]).toMatchObject({
      current: '17 intentos válidos de 17 intentos históricos.',
      calculation: 'Divide los intentos válidos entre todos tus intentos globales históricos y redondea el porcentaje a una puntuación sobre 100.',
      improve: 'Evita intentos excluidos o inválidos. El reinicio diario no borra el historial usado por esta estadística.',
    });
    expect(explanations[4]).toMatchObject({
      current: '0 referidos completados y +1 intento diario adicional.',
      calculation: 'Cada referido completado suma 20 puntos y cada intento diario adicional suma 8, con un máximo de 100/100.',
    });
  });

  it('explains empty reliability and normalizes malformed progression values', () => {
    const explanations = globalThis.window.Minuto106PlayerStats.statExplanations({
      attemptsUsed: 4,
      lifetimeAttemptsUsed: 'invalid',
      verifiedAttempts: -10,
      completedReferrals: -10,
      bonusAttempts: 'invalid',
    });

    expect(explanations.find(({ key }) => key === 'reliability')).toMatchObject({
      score: 0,
      current: 'Aún no hay intentos históricos para calcular el porcentaje.',
    });
    expect(explanations.find(({ key }) => key === 'impact')).toMatchObject({
      score: 0,
      current: '0 referidos completados y +0 intentos diarios adicionales.',
    });
  });

  it('keeps the compact impact explanation compatible with existing consumers', () => {
    expect(globalThis.window.Minuto106PlayerStats.impactExplanation({
      completedReferrals: 1,
      bonusAttempts: 2,
    })).toEqual({
      impact: 36,
      completedReferrals: 1,
      bonusAttempts: 2,
      copy: 'Impacto 36/100 · 1 referido completado · +2 intentos diarios adicionales. Cada referido completado suma 20 puntos y cada intento diario adicional suma 8.',
    });
  });
});
