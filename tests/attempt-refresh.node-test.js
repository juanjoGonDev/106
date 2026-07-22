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

function load(responses) {
  const requests = [];
  const events = [];
  const queue = [...responses];
  const window = {
    fetch: async (input, init) => {
      requests.push({ input, init });
      return queue.shift() ?? response();
    },
  };
  const context = {
    CustomEvent: TestCustomEvent,
    JSON,
    String,
    document: { dispatchEvent: (event) => events.push(event) },
    window,
  };
  vm.runInNewContext(source, context, { filename: 'public/attempt-refresh.js' });
  return { context, events, requests, window };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

test('dispatches the completed attempt payload after a successful finish', async () => {
  const detail = { stats: { awards: { goldenBoot: { nick: 'Ana' } } } };
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
});

test('dispatches a null detail when the cloned finish payload cannot be decoded', async () => {
  const harness = load([response({ jsonError: new Error('invalid json') })]);
  await harness.window.fetch('/game-api', { body: JSON.stringify({ action: 'finish' }) });
  await settle();
  assert.equal(harness.events.length, 1);
  assert.equal(harness.events[0].detail, null);
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
  await harness.window.fetch('/game-api', { body: JSON.stringify({ action: 'finish' }) });
  await settle();
  assert.equal(harness.events.length, 1);
  assert.equal(harness.requests.length, 1);
});