import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  KEEPALIVE_MODES,
  KEEPALIVE_SCHEDULES,
  KEEPALIVE_TARGET,
  KEEPALIVE_TIMEZONE,
  buildKeepalivePlan,
  completedKeepaliveArtifacts,
  keepaliveArtifactPrefix,
  keepaliveMode,
  keepaliveSlotIndex,
  shouldExecuteKeepalive,
  unusedKeepaliveModes,
} from '../scripts/supabase-keepalive-plan.mjs';

const DATE = '2026-10-03';
const PREFIX = `supabase-keepalive-${DATE}-`;

test('publishes the fixed coordination contract', () => {
  assert.equal(KEEPALIVE_TARGET, 3);
  assert.equal(KEEPALIVE_TIMEZONE, 'Europe/Madrid');
  assert.equal(KEEPALIVE_SCHEDULES.length, 8);
  assert.deepEqual([...KEEPALIVE_MODES], ['stats', 'leader-profile', 'random-profile']);
  assert.ok(Object.isFrozen(KEEPALIVE_SCHEDULES));
  assert.ok(Object.isFrozen(KEEPALIVE_MODES));
});

test('validates dates and maps configured schedules', () => {
  assert.equal(keepaliveArtifactPrefix(DATE), PREFIX);
  assert.throws(() => keepaliveArtifactPrefix('03-10-2026'), /YYYY-MM-DD/);
  assert.equal(keepaliveSlotIndex(KEEPALIVE_SCHEDULES[0]), 0);
  assert.equal(keepaliveSlotIndex(KEEPALIVE_SCHEDULES[7]), 7);
  assert.throws(() => keepaliveSlotIndex('0 0 * * *'), /Unknown keepalive schedule/);
});

test('filters only marker artifacts from the requested day', () => {
  const names = [
    `${PREFIX}10-stats`,
    `${PREFIX}11-leader-profile`,
    'supabase-keepalive-2026-10-02-9-stats',
    'platform-evidence-10',
    null,
  ];
  assert.deepEqual(completedKeepaliveArtifacts(names, DATE), names.slice(0, 2));
});

test('randomly samples early slots and forces the remaining slots needed to reach target', () => {
  assert.equal(shouldExecuteKeepalive({ completedCount: 0, slotIndex: 0, randomValue: 0 }), true);
  assert.equal(shouldExecuteKeepalive({ completedCount: 0, slotIndex: 0, randomValue: 0.9 }), false);
  assert.equal(shouldExecuteKeepalive({ completedCount: 0, slotIndex: 5, randomValue: 0.999 }), true);
  assert.equal(shouldExecuteKeepalive({ completedCount: 1, slotIndex: 6, randomValue: 0.999 }), true);
  assert.equal(shouldExecuteKeepalive({ completedCount: 2, slotIndex: 7, randomValue: 0.999 }), true);
  assert.equal(shouldExecuteKeepalive({ completedCount: 3, slotIndex: 0, randomValue: 0 }), false);
});

test('rejects invalid planner inputs', () => {
  assert.throws(() => shouldExecuteKeepalive({ completedCount: -1, slotIndex: 0, randomValue: 0 }), /completedCount/);
  assert.throws(() => shouldExecuteKeepalive({ completedCount: 1.5, slotIndex: 0, randomValue: 0 }), /completedCount/);
  assert.throws(() => shouldExecuteKeepalive({ completedCount: 0, slotIndex: -1, randomValue: 0 }), /slotIndex/);
  assert.throws(() => shouldExecuteKeepalive({ completedCount: 0, slotIndex: 8, randomValue: 0 }), /slotIndex/);
  assert.throws(() => shouldExecuteKeepalive({ completedCount: 0, slotIndex: 0, randomValue: -0.1 }), /randomValue/);
  assert.throws(() => shouldExecuteKeepalive({ completedCount: 0, slotIndex: 0, randomValue: 1 }), /randomValue/);
  assert.throws(() => keepaliveMode([], DATE, Number.NaN), /modeRandomValue/);
});

test('uses each activity mode once before allowing repeats', () => {
  const names = [`${PREFIX}1-stats`];
  assert.deepEqual(unusedKeepaliveModes(names, DATE), ['leader-profile', 'random-profile']);
  assert.equal(keepaliveMode(names, DATE, 0), 'leader-profile');
  assert.equal(keepaliveMode(names, DATE, 0.999), 'random-profile');

  const allUsed = KEEPALIVE_MODES.map((mode, index) => `${PREFIX}${index + 1}-${mode}`);
  assert.deepEqual(unusedKeepaliveModes(allUsed, DATE), []);
  assert.equal(keepaliveMode(allUsed, DATE, 0), 'stats');
  assert.equal(keepaliveMode(allUsed, DATE, 0.999), 'random-profile');
});

test('builds skipped and executable plans with stable marker names', () => {
  const skipped = buildKeepalivePlan({
    artifactNames: [`${PREFIX}1-stats`, `${PREFIX}2-leader-profile`, `${PREFIX}3-random-profile`],
    date: DATE,
    schedule: KEEPALIVE_SCHEDULES[0],
    randomValue: 0,
    modeRandomValue: 0,
    runId: '123',
  });
  assert.deepEqual(skipped, {
    execute: false,
    completedCount: 3,
    slotIndex: 0,
    mode: null,
    markerName: null,
  });
  assert.ok(Object.isFrozen(skipped));

  const execute = buildKeepalivePlan({
    artifactNames: [`${PREFIX}1-stats`],
    date: DATE,
    schedule: KEEPALIVE_SCHEDULES[7],
    randomValue: 0.999,
    modeRandomValue: 0,
    runId: 456,
  });
  assert.deepEqual(execute, {
    execute: true,
    completedCount: 1,
    slotIndex: 7,
    mode: 'leader-profile',
    markerName: `${PREFIX}456-leader-profile`,
  });
  assert.ok(Object.isFrozen(execute));

  assert.throws(() => buildKeepalivePlan({
    artifactNames: [],
    date: DATE,
    schedule: KEEPALIVE_SCHEDULES[7],
    randomValue: 0,
    modeRandomValue: 0,
    runId: 'bad-run',
  }), /runId/);
  assert.throws(() => buildKeepalivePlan({
    artifactNames: [],
    date: DATE,
    schedule: KEEPALIVE_SCHEDULES[7],
    randomValue: 0,
    modeRandomValue: 0,
    runId: null,
  }), /runId/);
});

test('keeps workflow schedules, timezone and pinned actions aligned with the planner contract', () => {
  const workflow = readFileSync(new URL('../.github/workflows/supabase-keepalive.yml', import.meta.url), 'utf8');
  for (const schedule of KEEPALIVE_SCHEDULES) {
    assert.equal(workflow.split(`cron: '${schedule}'`).length - 1, 1);
  }
  assert.equal(workflow.split('timezone: Europe/Madrid').length - 1, KEEPALIVE_SCHEDULES.length);
  assert.match(workflow, /permissions:\n {2}actions: read\n {2}contents: read/);
  assert.match(workflow, /actions\/checkout@d23441a48e516b6c34aea4fa41551a30e30af803/);
  assert.match(workflow, /actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020/);
  assert.match(workflow, /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/);
  assert.match(workflow, /SUPABASE_FUNCTIONS_URL: \$\{\{ vars\.SUPABASE_FUNCTIONS_URL \}\}/);
  assert.doesNotMatch(workflow, /secrets\./);
});
