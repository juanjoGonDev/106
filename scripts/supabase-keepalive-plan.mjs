export const KEEPALIVE_TARGET = 3;
export const KEEPALIVE_TIMEZONE = 'Europe/Madrid';
export const KEEPALIVE_MODES = Object.freeze(['stats', 'leader-profile', 'random-profile']);
export const KEEPALIVE_SCHEDULES = Object.freeze([
  '17 6 * * *',
  '43 8 * * *',
  '11 11 * * *',
  '37 13 * * *',
  '13 16 * * *',
  '41 18 * * *',
  '19 20 * * *',
  '47 21 * * *',
]);

const ARTIFACT_PREFIX = 'supabase-keepalive';

function assertProbability(value, name) {
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError(`${name} must be >= 0 and < 1.`);
  }
}

export function keepaliveArtifactPrefix(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new TypeError('date must use YYYY-MM-DD.');
  return `${ARTIFACT_PREFIX}-${date}-`;
}

export function keepaliveSlotIndex(schedule) {
  const index = KEEPALIVE_SCHEDULES.indexOf(schedule);
  if (index === -1) throw new RangeError(`Unknown keepalive schedule: ${schedule}`);
  return index;
}

export function completedKeepaliveArtifacts(artifactNames, date) {
  const prefix = keepaliveArtifactPrefix(date);
  return artifactNames.filter((name) => typeof name === 'string' && name.startsWith(prefix));
}

export function shouldExecuteKeepalive({ completedCount, slotIndex, randomValue }) {
  if (!Number.isInteger(completedCount) || completedCount < 0) {
    throw new RangeError('completedCount must be a non-negative integer.');
  }
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= KEEPALIVE_SCHEDULES.length) {
    throw new RangeError('slotIndex is outside the configured schedule range.');
  }
  assertProbability(randomValue, 'randomValue');

  const needed = Math.max(0, KEEPALIVE_TARGET - completedCount);
  if (needed === 0) return false;

  const remainingSlots = KEEPALIVE_SCHEDULES.length - slotIndex;
  if (remainingSlots <= needed) return true;
  return randomValue < needed / remainingSlots;
}

export function unusedKeepaliveModes(artifactNames, date) {
  const completed = completedKeepaliveArtifacts(artifactNames, date);
  return KEEPALIVE_MODES.filter((mode) => !completed.some((name) => name.endsWith(`-${mode}`)));
}

export function keepaliveMode(artifactNames, date, randomValue) {
  assertProbability(randomValue, 'modeRandomValue');
  const unused = unusedKeepaliveModes(artifactNames, date);
  const candidates = unused.length > 0 ? unused : KEEPALIVE_MODES;
  return candidates[Math.floor(randomValue * candidates.length)];
}

export function buildKeepalivePlan({
  artifactNames,
  date,
  schedule,
  randomValue,
  modeRandomValue,
  runId,
}) {
  const completed = completedKeepaliveArtifacts(artifactNames, date);
  const slotIndex = keepaliveSlotIndex(schedule);
  const execute = shouldExecuteKeepalive({
    completedCount: completed.length,
    slotIndex,
    randomValue,
  });

  if (!execute) {
    return Object.freeze({
      execute: false,
      completedCount: completed.length,
      slotIndex,
      mode: null,
      markerName: null,
    });
  }

  const normalizedRunId = String(runId ?? '').trim();
  if (!/^\d+$/.test(normalizedRunId)) throw new TypeError('runId must contain only decimal digits.');
  const mode = keepaliveMode(artifactNames, date, modeRandomValue);
  return Object.freeze({
    execute: true,
    completedCount: completed.length,
    slotIndex,
    mode,
    markerName: `${keepaliveArtifactPrefix(date)}${normalizedRunId}-${mode}`,
  });
}
