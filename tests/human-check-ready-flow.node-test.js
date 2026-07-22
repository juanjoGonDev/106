import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

await import('../public/human-check-ready-flow.js');

const api = globalThis.Minuto106HumanCheckReadyFlow;

afterEach(() => {
  delete globalThis.Minuto106HumanCheckReadyFlow;
});

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

test('publishes the exact ready window and countdown contract', () => {
  assert.equal(api.READY_WINDOW_MS, 120_000);
  assert.equal(api.COUNTDOWN_INTERVAL_MS, 1_000);
  assert.deepEqual(api.COUNTDOWN_VALUES, [3, 2, 1]);
  assert.deepEqual(api.PHASES, {
    SOLVING: 'solving',
    READY: 'ready',
    COUNTDOWN: 'countdown',
    COMPLETE: 'complete',
    EXPIRED: 'expired',
    CANCELLED: 'cancelled',
  });
});

test('requires a solved captcha and one explicit ready action before countdown', () => {
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

test('cancels safely from solving, ready, and countdown and ignores stale timers', () => {
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

test('dispose clears a pending ready timeout without changing phase', () => {
  const { flow, scheduler, getExpired } = createHarness();
  flow.dispose();
  flow.markSolved();
  flow.dispose();
  scheduler.advance(api.READY_WINDOW_MS);
  assert.equal(flow.getPhase(), api.PHASES.READY);
  assert.equal(getExpired(), 0);
});
