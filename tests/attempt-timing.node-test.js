import assert from 'node:assert/strict';
import { test } from 'node:test';

Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { webdriver: false },
});

await import('../public/attempt-timing.js');
const api = globalThis.Minuto106AttemptTiming;

function createScheduler() {
  let nextId = 1;
  const tasks = new Map();
  return {
    schedule(callback, delay) {
      const id = nextId;
      nextId += 1;
      tasks.set(id, { callback, delay, cancelled: false });
      return id;
    },
    cancelScheduled(id) {
      const task = tasks.get(id);
      if (task) task.cancelled = true;
    },
    invoke(id) {
      const task = tasks.get(id);
      if (!task || task.cancelled) return false;
      task.callback();
      return true;
    },
    latestId: () => nextId - 1,
    read: (id) => tasks.get(id),
  };
}

test('publishes the exact visible and maximum timing contract', () => {
  assert.equal(api.MIN_MANUAL_STOP_MS, 2_000);
  assert.equal(api.MAX_ATTEMPT_MS, 30_000);
});

test('manual stops require concealment and stay inside the bounded window', () => {
  assert.equal(api.canSubmitManualStop({ elapsedMs: 1_999, timerConcealed: true }), false);
  assert.equal(api.canSubmitManualStop({ elapsedMs: 2_000.4, timerConcealed: true }), true);
  assert.equal(api.canSubmitManualStop({ elapsedMs: 30_000, timerConcealed: true }), true);
  assert.equal(api.canSubmitManualStop({ elapsedMs: 30_001, timerConcealed: true }), false);
  assert.equal(api.canSubmitManualStop({ elapsedMs: 10_600, timerConcealed: false }), false);
  assert.equal(api.canSubmitManualStop({ elapsedMs: 'invalid', timerConcealed: true }), false);
});

test('creates an immutable nonce-bound automatic finish signal', () => {
  const signal = api.createAutomaticFinishSignal({
    interaction: { nonce: '550e8400-e29b-41d4-a716-446655440000', xPercent: 48, yPercent: 52 },
    elapsedMs: 30_000.4,
  });
  assert.equal(signal.finishEvent, 'timeout');
  assert.equal(signal.pointerType, 'timeout');
  assert.equal(signal.controlNonce, '550e8400-e29b-41d4-a716-446655440000');
  assert.equal(signal.pointerXPercent, 48);
  assert.equal(signal.pointerYPercent, 52);
  assert.equal(signal.clientElapsedMs, 30_000);
  assert.equal(signal.automaticFinish, true);
  assert.equal(signal.automationDetected, false);
  assert.equal(Object.isFrozen(signal), true);

  const fallback = api.createAutomaticFinishSignal({ interaction: null, elapsedMs: 'bad' });
  assert.equal(fallback.controlNonce, '');
  assert.equal(fallback.pointerXPercent, 50);
  assert.equal(fallback.pointerYPercent, 50);
  assert.equal(fallback.clientElapsedMs, 30_000);
});

test('starts once, expires once, and rejects stale lifecycle operations', () => {
  const scheduler = createScheduler();
  let expirations = 0;
  const deadline = api.createDeadline({
    schedule: scheduler.schedule,
    cancelScheduled: scheduler.cancelScheduled,
    onDeadline: () => { expirations += 1; },
    delayMs: 30_000.4,
  });
  assert.equal(deadline.start(), true);
  assert.equal(deadline.start(), false);
  const id = scheduler.latestId();
  assert.equal(scheduler.read(id).delay, 30_000);
  assert.equal(deadline.isCompleted(), false);
  assert.equal(scheduler.invoke(id), true);
  assert.equal(expirations, 1);
  assert.equal(deadline.isCompleted(), true);
  assert.equal(deadline.expire(), false);
  assert.equal(deadline.start(), false);
  assert.equal(deadline.cancel(), false);
});

test('cancels a pending deadline and supports direct expiry', () => {
  const scheduler = createScheduler();
  let expirations = 0;
  const cancelled = api.createDeadline({
    schedule: scheduler.schedule,
    cancelScheduled: scheduler.cancelScheduled,
    onDeadline: () => { expirations += 1; },
    delayMs: -50,
  });
  assert.equal(cancelled.start(), true);
  const id = scheduler.latestId();
  assert.equal(scheduler.read(id).delay, 0);
  assert.equal(cancelled.cancel(), true);
  assert.equal(cancelled.cancel(), false);
  assert.equal(scheduler.invoke(id), false);
  assert.equal(expirations, 0);
  assert.equal(cancelled.expire(), true);
  assert.equal(expirations, 1);

  const direct = api.createDeadline({
    schedule: scheduler.schedule,
    cancelScheduled: scheduler.cancelScheduled,
    onDeadline: () => { expirations += 1; },
  });
  assert.equal(direct.expire(), true);
  assert.equal(direct.isCompleted(), true);
  assert.equal(expirations, 2);
});

test('rejects missing deadline dependencies', () => {
  assert.throws(() => api.createDeadline({}), TypeError);
  assert.throws(() => api.createDeadline({ schedule() {}, cancelScheduled() {} }), TypeError);
});
