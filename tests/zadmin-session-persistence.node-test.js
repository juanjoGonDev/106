import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/zadmin/session-persistence.js', import.meta.url), 'utf8');
const KEY = 'minuto106.zadmin.session.v1';
const TOKEN_A = 'a'.repeat(64);
const TOKEN_B = 'b'.repeat(64);

class StorageStub {
  constructor(initial = {}) {
    this.values = new Map(Object.entries(initial));
    this.getCount = 0;
    this.setCount = 0;
    this.removeCount = 0;
    this.failGet = false;
    this.failSet = false;
    this.failRemove = false;
  }

  getItem(key) {
    this.getCount += 1;
    if (this.failGet) throw new Error('get blocked');
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    this.setCount += 1;
    if (this.failSet) throw new Error('set blocked');
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.removeCount += 1;
    if (this.failRemove) throw new Error('remove blocked');
    this.values.delete(key);
  }
}

class ElementStub {}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadPersistence({
  local = new StorageStub(),
  session = new StorageStub(),
  readyState = 'complete',
  targetCount = 1,
} = {}) {
  const domListeners = new Map();
  const windowListeners = new Map();
  const observers = [];
  const targets = Array.from({ length: targetCount }, () => new ElementStub());

  class MutationObserverStub {
    constructor(callback) {
      this.callback = callback;
      this.observed = [];
      observers.push(this);
    }

    observe(target, options) {
      this.observed.push({ target, options });
    }
  }

  const document = {
    readyState,
    addEventListener(type, callback, options) {
      domListeners.set(type, { callback, options });
    },
    querySelector(selector) {
      const selectors = ['#adminDashboard', '#adminLoginPanel', '#managementDashboard', '#managementDenied'];
      const index = selectors.indexOf(selector);
      return index >= 0 ? (targets[index] ?? null) : null;
    },
  };
  const window = {
    addEventListener(type, callback) {
      windowListeners.set(type, callback);
    },
  };
  const context = {
    HTMLElement: ElementStub,
    MutationObserver: MutationObserverStub,
    document,
    localStorage: local,
    sessionStorage: session,
    window,
  };
  vm.runInNewContext(source, context, { filename: 'public/zadmin/session-persistence.js' });
  return {
    api: context.Minuto106ZadminSessionPersistence,
    domListeners,
    local,
    observers,
    session,
    targets,
    windowListeners,
  };
}

test('promotes a persistent token to the tab and observes authenticated UI state', () => {
  const local = new StorageStub({ [KEY]: TOKEN_A.toUpperCase() });
  const session = new StorageStub();
  const harness = loadPersistence({ local, session, targetCount: 4 });

  assert.equal(harness.api.read(), TOKEN_A);
  assert.equal(session.values.get(KEY), TOKEN_A);
  assert.equal(harness.observers.length, 1);
  assert.equal(harness.observers[0].observed.length, 4);
  assert.deepEqual(plain(harness.observers[0].observed[0].options), { attributes: true, attributeFilter: ['hidden'] });
  assert.equal(typeof harness.windowListeners.get('pagehide'), 'function');
  assert.ok(Object.isFrozen(harness.api));

  session.values.set(KEY, TOKEN_B);
  harness.observers[0].callback();
  assert.equal(local.values.get(KEY), TOKEN_B);

  const writesBefore = local.setCount;
  harness.api.flush();
  assert.equal(local.setCount, writesBefore, 'equal persistent and tab tokens must not be rewritten');
});

test('promotes a legacy tab token to persistent storage and can replace or clear it', () => {
  const local = new StorageStub();
  const session = new StorageStub({ [KEY]: TOKEN_A });
  const harness = loadPersistence({ local, session });
  assert.equal(local.values.get(KEY), TOKEN_A);
  assert.equal(harness.api.read(), TOKEN_A);

  assert.equal(harness.api.store(`  ${TOKEN_B.toUpperCase()}  `), true);
  assert.equal(local.values.get(KEY), TOKEN_B);
  assert.equal(session.values.get(KEY), TOKEN_B);

  assert.equal(harness.api.store('invalid-token'), false);
  assert.equal(local.values.has(KEY), false);
  assert.equal(session.values.has(KEY), false);

  harness.api.store(TOKEN_A);
  harness.api.clear();
  assert.equal(harness.api.read(), '');
});

test('removes malformed persisted values and handles storage denial without exposing credentials', () => {
  const local = new StorageStub({ [KEY]: 'bad' });
  const session = new StorageStub({ [KEY]: 'also-bad' });
  const malformed = loadPersistence({ local, session, targetCount: 0 });
  assert.equal(malformed.api.read(), '');
  assert.ok(local.removeCount > 0);
  assert.ok(session.removeCount > 0);
  assert.equal(malformed.observers.length, 0);
  assert.equal(malformed.windowListeners.size, 0);

  const deniedLocal = new StorageStub();
  deniedLocal.failGet = true;
  deniedLocal.failSet = true;
  deniedLocal.failRemove = true;
  const allowedSession = new StorageStub({ [KEY]: TOKEN_A });
  const denied = loadPersistence({ local: deniedLocal, session: allowedSession });
  assert.equal(denied.api.read(), TOKEN_A);
  assert.equal(denied.api.store(TOKEN_B), false);
  assert.equal(allowedSession.values.get(KEY), TOKEN_B);
  denied.api.clear();
  assert.equal(allowedSession.values.has(KEY), false);

  const deniedSession = new StorageStub();
  deniedSession.failGet = true;
  deniedSession.failSet = true;
  deniedSession.failRemove = true;
  const onlyLocal = new StorageStub({ [KEY]: TOKEN_A });
  const fallback = loadPersistence({ local: onlyLocal, session: deniedSession });
  assert.equal(fallback.api.read(), TOKEN_A);
  assert.equal(fallback.api.store(TOKEN_B), true);
  assert.equal(onlyLocal.values.get(KEY), TOKEN_B);
});

test('defers observer wiring until DOMContentLoaded when the document is loading', () => {
  const harness = loadPersistence({ readyState: 'loading', targetCount: 2 });
  assert.equal(harness.observers.length, 0);
  const registration = harness.domListeners.get('DOMContentLoaded');
  assert.ok(registration);
  assert.deepEqual(plain(registration.options), { once: true });

  registration.callback();
  assert.equal(harness.observers.length, 1);
  assert.equal(harness.observers[0].observed.length, 2);
  assert.equal(typeof harness.windowListeners.get('pagehide'), 'function');
});

test('flush leaves persistent storage untouched when the tab has no usable token', () => {
  const local = new StorageStub({ [KEY]: TOKEN_A });
  const session = new StorageStub();
  const harness = loadPersistence({ local, session, targetCount: 0 });
  session.values.delete(KEY);
  const writes = local.setCount;
  harness.api.flush();
  assert.equal(local.setCount, writes);
  assert.equal(local.values.get(KEY), TOKEN_A);
});