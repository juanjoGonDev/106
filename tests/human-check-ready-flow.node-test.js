import assert from 'node:assert/strict';
import { test } from 'node:test';

await import('../public/human-check-ready-flow.js');

const api = globalThis.Minuto106HumanCheckReadyFlow;

function createScheduler() {
  let nextId = 1;
  let now = 0;
  const tasks = new Map();

  function schedule(callback, delay) {
    const id = nextId;
    nextId += 1;
    tasks.set(id, { callback, dueAt: now + delay, cancelled: false });
    return id;
  }

  function cancelScheduled(id) {
    const task = tasks.get(id);
    if (task) task.cancelled = true;
  }

  function advance(milliseconds) {
    const target = now + milliseconds;
    while (true) {
      const due = [...tasks.entries()]
        .filter(([, task]) => !task.cancelled && task.dueAt <= target)
        .sort((left, right) => left[1].dueAt - right[1].dueAt || left[0] - right[0])[0];
      if (!due) break;
      const [id, task] = due;
      tasks.delete(id);
      now = task.dueAt;
      task.callback();
    }
    now = target;
  }

  function latestId() {
    return nextId - 1;
  }

  function invoke(id) {
    tasks.get(id)?.callback();
  }

  return { schedule, cancelScheduled, advance, latestId, invoke };
}

function createHarness() {
  const scheduler = createScheduler();
  const phases = [];
  const countdown = [];
  let expired = 0;
  let completed = 0;
  const flow = api.createReadyCountdownFlow({
    schedule: scheduler.schedule,
    cancelScheduled: scheduler.cancelScheduled,
    onPhase: (phase) => phases.push(phase),
    onCountdown: (value) => countdown.push(value),
    onExpired: () => { expired += 1; },
    onComplete: () => { completed += 1; },
  });
  return {
    flow,
    scheduler,
    phases,
    countdown,
    getExpired: () => expired,
    getCompleted: () => completed,
  };
}

test('publishes the exact ready, countdown, and pointer contract', () => {
  assert.equal(api.READY_WINDOW_MS, 120_000);
  assert.equal(api.COUNTDOWN_INTERVAL_MS, 1_000);
  assert.deepEqual(api.COUNTDOWN_VALUES, [3, 2, 1]);
  assert.deepEqual(api.READY_POINTER_TYPES, ['mouse', 'touch', 'pen']);
  assert.deepEqual(api.PHASES, {
    SOLVING: 'solving',
    READY: 'ready',
    COUNTDOWN: 'countdown',
    COMPLETE: 'complete',
    EXPIRED: 'expired',
    CANCELLED: 'cancelled',
  });
});

test('creates bounded randomized targets for compact and large viewports', () => {
  const compact = api.createReadyTarget({ width: 0, height: 0, randomX: 0, randomY: 0 });
  assert.deepEqual(compact, { x: 18, y: 18, width: 190, height: 68 });

  const large = api.createReadyTarget({ width: 1_000, height: 800, randomX: 2, randomY: -1 });
  assert.equal(large.width, 300);
  assert.equal(large.height, 88);
  assert.ok(large.x > 680 && large.x < 682);
  assert.equal(large.y, 18);

  const middle = api.createReadyTarget({ width: 400, height: 300, randomX: 0.5, randomY: 0.5 });
  assert.deepEqual(middle, { x: 64, y: 106, width: 272, height: 68 });
});

test('hit testing includes edges and rejects malformed coordinates', () => {
  const target = { x: 10, y: 20, width: 100, height: 50 };
  assert.equal(api.isPointInsideTarget({ x: 10, y: 20 }, target), true);
  assert.equal(api.isPointInsideTarget({ x: 110, y: 70 }, target), true);
  assert.equal(api.isPointInsideTarget({ x: 9, y: 20 }, target), false);
  assert.equal(api.isPointInsideTarget({ x: 10, y: 71 }, target), false);
  assert.equal(api.isPointInsideTarget({ x: 'bad', y: 30 }, target), false);
  assert.equal(api.isPointInsideTarget(null, target), false);
});

test('accepts trusted primary mouse, touch, and pen only', () => {
  for (const pointerType of api.READY_POINTER_TYPES) {
    assert.equal(api.isTrustedReadyPointer({ isTrusted: true, isPrimary: true, pointerType }), true);
  }
  assert.equal(api.isTrustedReadyPointer({ isTrusted: false, isPrimary: true, pointerType: 'touch' }), false);
  assert.equal(api.isTrustedReadyPointer({ isTrusted: true, isPrimary: false, pointerType: 'touch' }), false);
  assert.equal(api.isTrustedReadyPointer({ isTrusted: true, isPrimary: true, pointerType: 'keyboard' }), false);
  assert.equal(api.isTrustedReadyPointer(null), false);
});

test('requires every ordered ball to move materially', () => {
  const previous = [
    { order: 1, x: 10, y: 10 },
    { order: 2, x: 30, y: 30 },
  ];
  const moved = [
    { order: 2, x: 45, y: 30 },
    { order: 1, x: 22, y: 10 },
  ];
  assert.equal(api.layoutsDiffer(previous, moved), true);
  assert.equal(api.layoutsDiffer(previous, [{ order: 1, x: 11, y: 10 }, { order: 2, x: 45, y: 30 }]), false);
  assert.equal(api.layoutsDiffer(previous, [{ order: 1, x: 22, y: 10 }, { order: 3, x: 45, y: 30 }]), false);
  assert.equal(api.layoutsDiffer(previous, [{ order: 1, x: 'x', y: 10 }, { order: 2, x: 45, y: 30 }]), false);
  assert.equal(api.layoutsDiffer(previous, previous, 0), true);
  assert.equal(api.layoutsDiffer(null, moved), false);
  assert.equal(api.layoutsDiffer(previous, null), false);
  assert.equal(api.layoutsDiffer(previous, [moved[0]]), false);
  assert.equal(api.layoutsDiffer([], []), false);
});

test('requires one explicit ready action before countdown completion', () => {
  const { flow, scheduler, phases, countdown, getCompleted } = createHarness();
  assert.equal(flow.getPhase(), api.PHASES.SOLVING);
  assert.equal(flow.startCountdown(), false);
  assert.equal(flow.markSolved(), true);
  assert.equal(flow.markSolved(), false);
  const readyTimer = scheduler.latestId();
  assert.equal(flow.startCountdown(), true);
  assert.equal(flow.startCountdown(), false);
  assert.equal(flow.markSolved(), false);
  assert.deepEqual(phases, [api.PHASES.READY, api.PHASES.COUNTDOWN]);
  assert.deepEqual(countdown, [3]);

  scheduler.invoke(readyTimer);
  assert.equal(flow.getPhase(), api.PHASES.COUNTDOWN);
  scheduler.advance(1_000);
  assert.deepEqual(countdown, [3, 2]);
  scheduler.advance(1_000);
  assert.deepEqual(countdown, [3, 2, 1]);
  scheduler.advance(1_000);
  assert.equal(flow.getPhase(), api.PHASES.COMPLETE);
  assert.equal(getCompleted(), 1);
  assert.equal(flow.cancel(), false);
  flow.dispose();
});

test('expires exactly two minutes after solving and cannot start afterwards', () => {
  const { flow, scheduler, phases, getExpired, getCompleted } = createHarness();
  assert.equal(flow.markSolved(), true);
  scheduler.advance(api.READY_WINDOW_MS - 1);
  assert.equal(flow.getPhase(), api.PHASES.READY);
  assert.equal(getExpired(), 0);
  scheduler.advance(1);
  assert.equal(flow.getPhase(), api.PHASES.EXPIRED);
  assert.equal(getExpired(), 1);
  assert.equal(getCompleted(), 0);
  assert.equal(flow.startCountdown(), false);
  assert.equal(flow.cancel(), false);
  assert.deepEqual(phases, [api.PHASES.READY, api.PHASES.EXPIRED]);
});

test('cancels from solving, ready, and countdown and ignores stale timers', () => {
  const solving = createHarness();
  assert.equal(solving.flow.cancel(), true);
  assert.equal(solving.flow.cancel(), false);

  const ready = createHarness();
  ready.flow.markSolved();
  const readyTimer = ready.scheduler.latestId();
  assert.equal(ready.flow.cancel(), true);
  ready.scheduler.invoke(readyTimer);
  assert.equal(ready.flow.getPhase(), api.PHASES.CANCELLED);
  assert.equal(ready.getExpired(), 0);

  const countdown = createHarness();
  countdown.flow.markSolved();
  countdown.flow.startCountdown();
  const countdownTimer = countdown.scheduler.latestId();
  assert.equal(countdown.flow.cancel(), true);
  countdown.scheduler.invoke(countdownTimer);
  assert.equal(countdown.flow.getPhase(), api.PHASES.CANCELLED);
  assert.equal(countdown.getCompleted(), 0);
});

test('dispose clears pending work without changing phase', () => {
  const { flow, scheduler, getExpired } = createHarness();
  flow.dispose();
  flow.markSolved();
  flow.dispose();
  scheduler.advance(api.READY_WINDOW_MS);
  assert.equal(flow.getPhase(), api.PHASES.READY);
  assert.equal(getExpired(), 0);
});
