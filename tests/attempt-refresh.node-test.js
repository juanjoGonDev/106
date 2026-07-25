import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/attempt-refresh.js', import.meta.url), 'utf8');

class TestCustomEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.detail = options.detail;
  }
}

function response({ ok = true, detail = {}, jsonError = null } = {}) {
  return {
    ok,
    clone() {
      return {
        json: async () => {
          if (jsonError) throw jsonError;
          return detail;
        },
      };
    },
  };
}

function load(responses, { existingUnlockScript = false } = {}) {
  const requests = [];
  const events = [];
  const listeners = new Map();
  const queue = [...responses];
  const scripts = existingUnlockScript ? [{ id: 'minuto106AchievementUnlocksScript' }] : [];
  const window = {
    fetch: async (input, init) => {
      requests.push({ input, init });
      return queue.shift() ?? response();
    },
  };
  const document = {
    head: {
      append(script) {
        scripts.push(script);
      },
    },
    createElement(tagName) {
      return { tagName, id: '', src: '', async: true };
    },
    getElementById(id) {
      return scripts.find((script) => script.id === id) ?? null;
    },
    addEventListener(type, listener) {
      const registered = listeners.get(type) ?? [];
      registered.push(listener);
      listeners.set(type, registered);
    },
    dispatchEvent(event) {
      events.push(event);
      for (const listener of listeners.get(event.type) ?? []) listener(event);
    },
  };
  const context = {
    CustomEvent: TestCustomEvent,
    JSON,
    String,
    document,
    window,
  };
  vm.runInNewContext(source, context, { filename: 'public/attempt-refresh.js' });
  return { context, document, events, requests, scripts, window };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

test('loads the achievement notification asset once', () => {
  const harness = load([]);
  assert.equal(harness.scripts.length, 1);
  assert.equal(harness.scripts[0].tagName, 'script');
  assert.equal(harness.scripts[0].id, 'minuto106AchievementUnlocksScript');
  assert.equal(harness.scripts[0].src, './achievement-unlocks.js');
  assert.equal(harness.scripts[0].async, false);

  const existing = load([], { existingUnlockScript: true });
  assert.equal(existing.scripts.length, 1);
});

test('retains and clears player context baselines', () => {
  const harness = load([]);
  const detail = { availability: 'owned', profile: { nick: 'Ana' } };
  harness.document.dispatchEvent(new TestCustomEvent('minuto106:player-context', { detail }));
  assert.deepEqual(harness.window.__MINUTO106_PLAYER_CONTEXT__, detail);
  harness.document.dispatchEvent(new TestCustomEvent('minuto106:player-context', { detail: {} }));
  assert.equal(harness.window.__MINUTO106_PLAYER_CONTEXT__, null);
});

test('dispatches and retains the completed attempt payload after a successful finish', async () => {
  const attempt = { id: 'attempt-one', elapsedMs: 10_604 };
  const detail = { attempt, stats: { awards: { goldenBoot: { nick: 'Ana' } } } };
  const harness = load([response({ detail })]);
  const returned = await harness.window.fetch('/game-api', {
    method: 'POST',
    body: JSON.stringify({ action: 'finish', challengeId: 'one' }),
  });
  await settle();

  assert.equal(returned.ok, true);
  assert.equal(harness.requests.length, 1);
  assert.equal(harness.events.length, 1);
  assert.equal(harness.events[0].type, 'minuto106:attempt-finished');
  assert.deepEqual(harness.events[0].detail, detail);
  assert.deepEqual(harness.window.__MINUTO106_LATEST_ATTEMPT__, attempt);
});

test('retains attempts from external completion events for late-loaded share actions', () => {
  const harness = load([]);
  const attempt = { id: 'external-attempt', differenceMs: 4 };
  harness.document.dispatchEvent(new TestCustomEvent('minuto106:attempt-finished', { detail: { attempt } }));
  assert.deepEqual(harness.window.__MINUTO106_LATEST_ATTEMPT__, attempt);
});

test('dispatches a null detail and clears the retained attempt when decoding fails', async () => {
  const harness = load([response({ jsonError: new Error('invalid json') })]);
  harness.window.__MINUTO106_LATEST_ATTEMPT__ = { id: 'stale' };
  await harness.window.fetch('/game-api', { body: JSON.stringify({ action: 'finish' }) });
  await settle();
  assert.equal(harness.events.length, 1);
  assert.equal(harness.events[0].detail, null);
  assert.equal(harness.window.__MINUTO106_LATEST_ATTEMPT__, null);
});

test('does not publish events for unrelated, invalid or bodyless requests', async () => {
  const harness = load([response(), response(), response()]);
  await harness.window.fetch('/game-api', { body: JSON.stringify({ action: 'stats' }) });
  await harness.window.fetch('/game-api', { body: '{not-json' });
  await harness.window.fetch('/game-api', { body: new Uint8Array([1]) });
  await settle();
  assert.equal(harness.events.length, 0);
  assert.equal(harness.requests.length, 3);
});

test('handles a valid JSON body without an action as unrelated', async () => {
  const harness = load([response()]);
  await harness.window.fetch('/game-api', { body: JSON.stringify({ nick: 'Ana' }) });
  await settle();
  assert.equal(harness.events.length, 0);
});

test('does not publish rejected finish responses', async () => {
  const harness = load([response({ ok: false, detail: { ignored: true } })]);
  const returned = await harness.window.fetch('/game-api', { body: JSON.stringify({ action: 'finish' }) });
  await settle();
  assert.equal(returned.ok, false);
  assert.equal(harness.events.length, 0);
});

test('installs the wrapper only once', async () => {
  const harness = load([response({ detail: { first: true } })]);
  const wrapped = harness.window.fetch;
  vm.runInNewContext(source, harness.context, { filename: 'public/attempt-refresh.js' });
  assert.equal(harness.window.fetch, wrapped);
  assert.equal(harness.scripts.length, 1);
  await harness.window.fetch('/game-api', { body: JSON.stringify({ action: 'finish' }) });
  await settle();
  assert.equal(harness.events.length, 1);
  assert.equal(harness.requests.length, 1);
});
