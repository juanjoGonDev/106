// Generated from shared/player-radar-model.js. Run `node scripts/sync-player-radar-model.mjs`; do not edit directly.
// Global card cache revision. Keep it strictly newer than every database migration.
export const PLAYER_CARD_RENDERER_REVISION = 20260810030001;

export const PLAYER_RADAR_POLICY = Object.freeze({
  precisionMaximumDifferenceMs: 1000,
  consistencyMaximumDifferenceMs: 1500,
  experienceMaximumVerifiedAttempts: 20,
  impactPointsPerReferral: 20,
  impactPointsPerBonusAttempt: 8,
});

export const PLAYER_RADAR_KEYS = Object.freeze([
  'precision',
  'consistency',
  'experience',
  'reliability',
  'impact',
]);

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

function nonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function inverseScore(value, maximum) {
  const number = Number(value);
  return Number.isFinite(number)
    ? clampScore(100 - (number / maximum) * 100)
    : 0;
}

export function resolveLifetimeAttemptsUsed(profile = {}) {
  const source = Object.prototype.hasOwnProperty.call(profile, 'lifetimeAttemptsUsed')
    ? profile.lifetimeAttemptsUsed
    : profile.attemptsUsed;
  return Math.trunc(nonNegativeNumber(source));
}

export function buildPlayerRadarStats(profile = {}) {
  const lifetimeAttemptsUsed = resolveLifetimeAttemptsUsed(profile);
  const verifiedAttempts = nonNegativeNumber(profile.verifiedAttempts);
  const completedReferrals = nonNegativeNumber(profile.completedReferrals);
  const bonusAttempts = nonNegativeNumber(profile.bonusAttempts);

  return Object.freeze({
    precision: inverseScore(
      profile.bestDifferenceMs,
      PLAYER_RADAR_POLICY.precisionMaximumDifferenceMs,
    ),
    consistency: inverseScore(
      profile.averageDifferenceMs,
      PLAYER_RADAR_POLICY.consistencyMaximumDifferenceMs,
    ),
    experience: clampScore(
      (verifiedAttempts / PLAYER_RADAR_POLICY.experienceMaximumVerifiedAttempts) * 100,
    ),
    reliability: lifetimeAttemptsUsed > 0
      ? clampScore((verifiedAttempts / lifetimeAttemptsUsed) * 100)
      : 0,
    impact: clampScore(
      completedReferrals * PLAYER_RADAR_POLICY.impactPointsPerReferral
        + bonusAttempts * PLAYER_RADAR_POLICY.impactPointsPerBonusAttempt,
    ),
  });
}

export function playerRadarStatsArray(profile = {}) {
  const stats = buildPlayerRadarStats(profile);
  return Object.freeze(PLAYER_RADAR_KEYS.map((key) => stats[key]));
}
