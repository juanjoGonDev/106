export const DAILY_ATTEMPT_BASE = 5;
export const DAILY_ATTEMPT_CEILING = 10;
export const DAILY_REFERRAL_BONUS_CEILING = DAILY_ATTEMPT_CEILING - DAILY_ATTEMPT_BASE;

function finiteInteger(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function hasPlayerProfile(profile) {
  return Boolean(
    profile
    && typeof profile === 'object'
    && !Array.isArray(profile)
    && String(profile.nick ?? '').trim(),
  );
}

export function normalizeDailyAttemptProfile(profile) {
  const source = profile && typeof profile === 'object' ? profile : {};
  const bonusAttempts = clamp(
    finiteInteger(source.bonusAttempts),
    0,
    DAILY_REFERRAL_BONUS_CEILING,
  );
  const maxAttempts = clamp(
    finiteInteger(source.maxAttempts, DAILY_ATTEMPT_BASE + bonusAttempts),
    DAILY_ATTEMPT_BASE,
    DAILY_ATTEMPT_CEILING,
  );
  const attemptsUsed = clamp(finiteInteger(source.attemptsUsed), 0, maxAttempts);
  const attemptsReserved = clamp(
    finiteInteger(source.dailyAttemptsReserved),
    0,
    Math.max(0, maxAttempts - attemptsUsed),
  );
  const attemptsLeft = clamp(
    finiteInteger(source.attemptsLeft, maxAttempts - attemptsUsed - attemptsReserved),
    0,
    maxAttempts,
  );
  const completedReferrals = Math.max(0, finiteInteger(source.completedReferrals));
  const resetAt = typeof source.dailyResetAt === 'string' ? source.dailyResetAt : '';

  return Object.freeze({
    attemptsUsed,
    attemptsReserved,
    attemptsLeft,
    maxAttempts,
    bonusAttempts,
    completedReferrals,
    resetAt,
    exhausted: attemptsLeft === 0,
    atCeiling: maxAttempts === DAILY_ATTEMPT_CEILING,
  });
}

export function resolveDailyAttemptState(profile, accountPolicy) {
  return normalizeDailyAttemptProfile(hasPlayerProfile(profile) ? profile : accountPolicy);
}

export function millisecondsUntilReset(resetAt, nowMs = Date.now()) {
  const resetMs = Date.parse(String(resetAt ?? ''));
  if (!Number.isFinite(resetMs) || !Number.isFinite(Number(nowMs))) return 0;
  return Math.max(0, resetMs - Number(nowMs));
}

export function formatDailyCountdown(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(Number(milliseconds) / 1000) || 0);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
}

export function dailyReferralProgress(state) {
  const normalized = normalizeDailyAttemptProfile(state);
  if (normalized.atCeiling) {
    return Object.freeze({
      current: DAILY_REFERRAL_BONUS_CEILING,
      target: DAILY_REFERRAL_BONUS_CEILING,
      remaining: 0,
      copy: 'Has alcanzado el máximo diario de 10 intentos por nick.',
    });
  }

  const current = normalized.bonusAttempts;
  return Object.freeze({
    current,
    target: DAILY_REFERRAL_BONUS_CEILING,
    remaining: DAILY_REFERRAL_BONUS_CEILING - current,
    copy: `Invita a ${DAILY_REFERRAL_BONUS_CEILING - current} usuario${DAILY_REFERRAL_BONUS_CEILING - current === 1 ? '' : 's'} más para llegar al máximo diario.`,
  });
}

export function exhaustedDailyLimitCopy(profile) {
  const state = normalizeDailyAttemptProfile(profile);
  if (!state.exhausted) return '';
  return `Has agotado tus ${state.maxAttempts} intentos globales de hoy.`;
}
