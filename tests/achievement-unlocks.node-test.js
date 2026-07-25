import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/achievement-unlocks.js', import.meta.url), 'utf8');

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(...values) {
    for (const value of values) this.values.add(value);
  }

  remove(...values) {
    for (const value of values) this.values.delete(value);
  }

  contains(value) {
    return this.values.has(value);
  }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.id = '';
    this.rel = '';
    this.href = '';
    this.className = '';
    this.textContent = '';
    this.hidden = false;
    this.children = [];
    this.attributes = new Map();
    this.classList = new FakeClassList();
    this.removed = false;
  }

  append(...children) {
    this.children.push(...children);
  }

  setAttribute(name, value) {
    this.attributes.set(name, value);
  }

  remove() {
    this.removed = true;
  }
}

class FakeDocument {
  constructor({ currentScriptSrc = 'https://example.test/106/achievement-unlocks.js', existingStyle = false } = {}) {
    this.body = new FakeElement('body');
    this.head = new FakeElement('head');
    this.listeners = new Map();
    this.currentScript = currentScriptSrc ? { src: currentScriptSrc } : null;
    if (existingStyle) {
      const stylesheet = new FakeElement('link');
      stylesheet.id = 'minuto106AchievementUnlockStyles';
      this.head.append(stylesheet);
    }
  }

  createElement(tagName) {
    return new FakeElement(tagName);
  }

  getElementById(id) {
    return [...this.head.children, ...this.body.children].find((element) => element.id === id) ?? null;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type, detail) {
    for (const listener of this.listeners.get(type) ?? []) listener({ detail });
  }
}

function scheduler() {
  let nextId = 1;
  const jobs = [];
  const cancelled = [];
  return {
    jobs,
    cancelled,
    schedule(callback, delay) {
      const job = { id: nextId, callback, delay };
      nextId += 1;
      jobs.push(job);
      return job.id;
    },
    cancel(id) {
      cancelled.push(id);
    },
    runNext() {
      const job = jobs.shift();
      assert.ok(job, 'expected a scheduled job');
      job.callback();
      return job;
    },
  };
}

function load({
  contextProfile = null,
  currentScriptSrc,
  existingStyle = false,
  frame = (callback) => callback(),
} = {}) {
  const document = new FakeDocument({ currentScriptSrc, existingStyle });
  const clock = scheduler();
  const window = {
    __MINUTO106_PLAYER_CONTEXT__: contextProfile,
    setTimeout: clock.schedule,
    clearTimeout: clock.cancel,
    requestAnimationFrame: frame,
  };
  const context = { document, window, Array, Boolean, Number, Object, Set, String, URL };
  vm.runInNewContext(source, context, { filename: 'public/achievement-unlocks.js' });
  return { api: window.Minuto106AchievementUnlocks, clock, document, window };
}

function profile(items) {
  return { achievements: { items } };
}

test('boots once with versioned styles and creates an accessible notification view', () => {
  const harness = load();
  const [stylesheet] = harness.document.head.children;
  assert.equal(stylesheet.tagName, 'link');
  assert.equal(stylesheet.id, 'minuto106AchievementUnlockStyles');
  assert.equal(stylesheet.rel, 'stylesheet');
  assert.equal(stylesheet.href, 'https://example.test/106/v17.css');
  assert.equal(harness.api.ensureAchievementUnlockStyles(harness.document), stylesheet);

  const [root] = harness.document.body.children;
  assert.equal(root.tagName, 'aside');
  assert.equal(root.hidden, true);
  assert.equal(root.attributes.get('role'), 'status');
  assert.equal(root.attributes.get('aria-live'), 'polite');
  assert.equal(root.attributes.get('aria-atomic'), 'true');
  assert.equal(harness.document.listeners.get('minuto106:player-context').length, 1);
  assert.equal(harness.document.listeners.get('minuto106:attempt-finished').length, 1);
  const notifier = harness.window.Minuto106AchievementUnlockNotifier;
  assert.equal(harness.api.bootAchievementUnlocks(harness.window, harness.document), notifier);
  assert.equal(harness.document.body.children.length, 1);
  assert.equal(harness.document.head.children.length, 1);

  const fallback = load({ currentScriptSrc: '' });
  assert.equal(fallback.document.head.children[0].href, 'v17.css');
  const existing = load({ existingStyle: true });
  assert.equal(existing.document.head.children.length, 1);
});

test('finds only distinct newly unlocked achievements and normalizes display data', () => {
  const harness = load();
  const previous = profile([
    { code: 'old', title: 'Old' },
    null,
    { code: '' },
  ]);
  const next = profile([
    { code: 'old', title: 'Old again' },
    { code: 'new', title: '', description: null, points: '15' },
    { code: 'new', title: 'Duplicate', points: 20 },
    { code: 'free', description: 'No points', points: 0 },
    { title: 'Missing code' },
    'invalid',
  ]);

  assert.deepEqual(
    structuredClone(harness.api.findNewAchievements(previous, next)),
    [
      { code: 'new', title: 'Logro desbloqueado', description: '', points: 15 },
      { code: 'free', title: 'Logro desbloqueado', description: 'No points', points: null },
    ],
  );
  assert.deepEqual(structuredClone(harness.api.findNewAchievements(null, null)), []);
});

test('queues notifications sequentially and renders optional points', () => {
  const harness = load();
  const view = harness.api.createAchievementUnlockView(harness.document);
  const clock = scheduler();
  const notifier = harness.api.createAchievementUnlockNotifier({
    view,
    schedule: clock.schedule,
    cancel: clock.cancel,
    frame: (callback) => callback(),
    displayMs: 10,
    exitMs: 5,
  });

  assert.equal(notifier.enqueue(null), 0);
  assert.equal(notifier.enqueue([], { delayMs: 5 }), 0);
  assert.equal(notifier.enqueue([
    { code: 'one', title: 'Primero', description: 'Uno', points: 10 },
    { code: 'two', title: 'Segundo', description: 'Dos', points: null },
  ]), 2);
  assert.equal(view.root.hidden, false);
  assert.equal(view.root.classList.contains('is-visible'), true);
  assert.equal(view.title.textContent, 'Primero');
  assert.equal(view.points.hidden, false);
  assert.equal(view.points.textContent, '+10 PUNTOS');

  assert.equal(notifier.enqueue([{ code: 'three', title: 'Tercero', description: '', points: 1 }]), 1);
  assert.equal(clock.runNext().delay, 10);
  assert.equal(view.root.classList.contains('is-leaving'), true);
  assert.equal(clock.runNext().delay, 5);
  assert.equal(view.title.textContent, 'Segundo');
  assert.equal(view.points.hidden, true);
  assert.equal(view.points.textContent, '');
  clock.runNext();
  clock.runNext();
  assert.equal(view.title.textContent, 'Tercero');
  clock.runNext();
  clock.runNext();
  assert.equal(view.root.hidden, true);
});

test('supports an initial delay and cancels active work when destroyed', () => {
  const harness = load();
  const view = harness.api.createAchievementUnlockView(harness.document);
  const clock = scheduler();
  const frames = [];
  const notifier = harness.api.createAchievementUnlockNotifier({
    view,
    schedule: clock.schedule,
    cancel: clock.cancel,
    frame: (callback) => frames.push(callback),
  });

  assert.equal(notifier.enqueue([{ code: 'one', title: 'One', description: '', points: null }], { delayMs: 25 }), 1);
  assert.equal(view.root.hidden, true);
  assert.equal(clock.runNext().delay, 25);
  assert.equal(view.root.hidden, false);
  assert.equal(frames.length, 1);
  notifier.destroy();
  frames.shift()();
  assert.equal(view.root.classList.contains('is-visible'), false);
  assert.equal(view.root.removed, true);
  assert.deepEqual(clock.cancelled, [2]);
  assert.equal(notifier.enqueue([{ code: 'ignored' }]), 1);
});

test('tracks profile baselines and announces attempt deltas after rank celebrations', () => {
  const harness = load({
    contextProfile: { availability: 'owned', profile: profile([{ code: 'old' }]) },
  });
  const root = harness.document.body.children[0];

  harness.document.dispatch('minuto106:attempt-finished', {
    profile: profile([{ code: 'old' }, { code: 'new', title: 'Nuevo', description: 'Conseguido', points: 8 }]),
    achievement: { enteredTop10: true },
  });
  assert.equal(harness.clock.jobs[0].delay, 2_200);
  harness.clock.runNext();
  assert.equal(root.hidden, false);

  harness.document.dispatch('minuto106:player-context', { availability: 'unknown' });
  harness.document.dispatch('minuto106:attempt-finished', { profile: {} });

  const worldRecordHarness = load();
  worldRecordHarness.document.dispatch('minuto106:attempt-finished', {
    profile: profile([{ code: 'fresh' }]),
    achievement: { isWorldRecord: true },
  });
  assert.equal(worldRecordHarness.clock.jobs[0].delay, 3_600);

  assert.equal(harness.api.notificationDelay({ isWorldRecord: true }), 3_600);
  assert.equal(harness.api.notificationDelay({ enteredTop10: true }), 2_200);
  assert.equal(harness.api.notificationDelay({}), 350);
});
