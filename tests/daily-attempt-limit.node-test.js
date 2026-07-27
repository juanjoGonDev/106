import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DAILY_ATTEMPT_BASE,
  DAILY_ATTEMPT_CEILING,
  DAILY_REFERRAL_BONUS_CEILING,
  dailyReferralProgress,
  exhaustedDailyLimitCopy,
  formatDailyCountdown,
  millisecondsUntilReset,
  normalizeDailyAttemptProfile,
} from '../public/daily-attempt-limit.js';

test('normalizes missing, malformed and bounded daily profile values', () => {
  assert.deepEqual(normalizeDailyAttemptProfile(null), {
    attemptsUsed: 0,
    attemptsReserved: 0,
    attemptsLeft: 5,
    maxAttempts: 5,
    bonusAttempts: 0,
    completedReferrals: 0,
    resetAt: '',
    exhausted: false,
    atCeiling: false,
  });

  assert.deepEqual(normalizeDailyAttemptProfile({
    attemptsUsed: 50,
    dailyAttemptsReserved: 8,
    attemptsLeft: -4,
    maxAttempts: 99,
    bonusAttempts: 99,
    completedReferrals: -3,
    dailyResetAt: 42,
  }), {
    attemptsUsed: 10,
    attemptsReserved: 0,
    attemptsLeft: 0,
    maxAttempts: 10,
    bonusAttempts: 5,
    completedReferrals: 0,
    resetAt: '',
    exhausted: true,
    atCeiling: true,
  });

  assert.deepEqual(normalizeDailyAttemptProfile({
    attemptsUsed: '2.9',
    dailyAttemptsReserved: '2',
    attemptsLeft: '3',
    bonusAttempts: '2',
    completedReferrals: '4',
    dailyResetAt: '2026-07-28T00:00:00.000Z',
  }), {
    attemptsUsed: 2,
    attemptsReserved: 2,
    attemptsLeft: 3,
    maxAttempts: 7,
    bonusAttempts: 2,
    completedReferrals: 4,
    resetAt: '2026-07-28T00:00:00.000Z',
    exhausted: false,
    atCeiling: false,
  });
});

test('formats reset time without trusting invalid clocks', () => {
  const resetAt = '2026-07-28T00:00:00.000Z';
  const now = Date.parse('2026-07-27T22:59:58.250Z');
  assert.equal(millisecondsUntilReset(resetAt, now), 3_601_750);
  assert.equal(millisecondsUntilReset(null, now), 0);
  assert.equal(millisecondsUntilReset('invalid', now), 0);
  assert.equal(millisecondsUntilReset(resetAt, Number.NaN), 0);
  assert.equal(millisecondsUntilReset('2026-07-27T20:00:00.000Z', now), 0);
  assert.equal(formatDailyCountdown(3_601_001), '01:00:02');
  assert.equal(formatDailyCountdown(-1), '00:00:00');
  assert.equal(formatDailyCountdown(Number.NaN), '00:00:00');
});

test('describes referral progress and exhausted copy at every boundary', () => {
  assert.equal(DAILY_ATTEMPT_BASE, 5);
  assert.equal(DAILY_ATTEMPT_CEILING, 10);
  assert.equal(DAILY_REFERRAL_BONUS_CEILING, 5);

  assert.deepEqual(dailyReferralProgress({ bonusAttempts: 4, maxAttempts: 9 }), {
    current: 4,
    target: 5,
    remaining: 1,
    copy: 'Invita a 1 usuario más para llegar al máximo diario.',
  });
  assert.deepEqual(dailyReferralProgress({ bonusAttempts: 2, maxAttempts: 7 }), {
    current: 2,
    target: 5,
    remaining: 3,
    copy: 'Invita a 3 usuarios más para llegar al máximo diario.',
  });
  assert.deepEqual(dailyReferralProgress({ bonusAttempts: 5, maxAttempts: 10 }), {
    current: 5,
    target: 5,
    remaining: 0,
    copy: 'Has alcanzado el máximo diario de 10 intentos por nick.',
  });

  assert.equal(exhaustedDailyLimitCopy({ attemptsLeft: 2 }), '');
  assert.equal(exhaustedDailyLimitCopy({
    attemptsUsed: 6,
    attemptsLeft: 0,
    maxAttempts: 6,
    dailyResetAt: '2026-07-28T00:00:00.000Z',
  }, Date.parse('2026-07-27T23:59:58.500Z')),
  'Has agotado tus 6 intentos globales de hoy. Se reinician en 00:00:02, según la hora del servidor.');
});
