import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const source = readFileSync('public/access.js', 'utf8');
const accountStorageKey = 'minuto106:account-access-v1';

class TestCustomEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.detail = options.detail;
  }
}

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
  };
}

function loadAccess(initialStorage = {}) {
  const requests = [];
  const events = [];
  const localStorage = createStorage(initialStorage);
  const document = {
    addEventListener: () => {},
    dispatchEvent: (event) => { events.push(event); },
    querySelector: (selector) => (selector === '#nick' ? { value: 'ChromeMobile' } : null),
  };
  const window = {
    fetch: async (input, init) => {
      requests.push({ input, init });
      return new Response('{}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  };

  vm.runInNewContext(source, {
    Array,
    CustomEvent: TestCustomEvent,
    Headers,
    JSON,
    Object,
    Response,
    String,
    Uint8Array,
    console,
    crypto: webcrypto,
    document,
    localStorage,
    navigator: { clipboard: { writeText: async () => {} } },
    setTimeout,
    window,
  });

  return { events, localStorage, requests, window };
}

describe('prepared-start account bootstrap', () => {
  it('generates and forwards an account key when browser storage is empty', async () => {
    const harness = loadAccess();

    await harness.window.fetch('https://example.test/game-ready-api', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'prepare-start', nick: 'ChromeMobile', team: 'spain' }),
    });

    const token = harness.localStorage.getItem(accountStorageKey);
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(harness.requests).toHaveLength(1);
    expect(harness.requests[0].init.headers.get('x-account-token')).toBe(token);
    expect(harness.events.map((event) => event.type)).toContain('minuto106:account-updated');
  });

  it('reuses an existing account key instead of replacing it', async () => {
    const existingToken = 'ab'.repeat(32);
    const harness = loadAccess({ [accountStorageKey]: existingToken });

    await harness.window.fetch('https://example.test/game-ready-api', {
      method: 'POST',
      body: JSON.stringify({ action: 'prepare-start', nick: 'ChromeMobile', team: 'argentina' }),
    });

    expect(harness.localStorage.getItem(accountStorageKey)).toBe(existingToken);
    expect(harness.requests[0].init.headers.get('x-account-token')).toBe(existingToken);
    expect(harness.events).toHaveLength(0);
  });
});
