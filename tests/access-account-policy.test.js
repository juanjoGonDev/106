import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

const source = readFileSync('public/access.js', 'utf8');
const policyKey = 'minuto106:account-daily-attempt-policy-v1';
const tokenKey = 'minuto106:account-access-v1';

function runtime(initial = {}) {
  const values = new Map(Object.entries(initial));
  let accountUpdates = 0;
  const localStorage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
  const document = {
    addEventListener() {},
    dispatchEvent(event) {
      if (event.type === 'minuto106:account-updated') accountUpdates += 1;
      return true;
    },
    querySelector() { return null; },
  };
  const window = {
    fetch: async () => ({ ok: true }),
    addEventListener() {},
  };
  const context = vm.createContext({
    console,
    crypto: webcrypto,
    CustomEvent: class CustomEvent {
      constructor(type, options = {}) {
        this.type = type;
        this.detail = options.detail;
      }
    },
    document,
    Headers,
    localStorage,
    setTimeout,
    window,
  });
  vm.runInContext(source, context, { filename: 'public/access.js' });
  return {
    access: window.Minuto106Access,
    accountUpdates: () => accountUpdates,
    value: (key) => values.get(key),
  };
}

describe('account daily attempt policy storage', () => {
  it('writes token and policy atomically and clears both on logout', () => {
    const browser = runtime();
    const policy = { maxAttempts: 6, attemptsLeft: 6, bonusAttempts: 1 };

    browser.access.setAccountSession('a'.repeat(64), policy);
    expect(browser.value(tokenKey)).toBe('a'.repeat(64));
    expect(JSON.parse(browser.value(policyKey))).toEqual(policy);
    expect(browser.access.getAccountDailyAttemptPolicy()).toEqual(policy);
    expect(browser.accountUpdates()).toBe(1);

    browser.access.clearAccountSession();
    expect(browser.value(tokenKey)).toBeUndefined();
    expect(browser.value(policyKey)).toBeUndefined();
    expect(browser.accountUpdates()).toBe(2);
  });

  it('invalidates stale policy whenever account credentials change', () => {
    const browser = runtime({ [policyKey]: JSON.stringify({ maxAttempts: 9 }) });

    browser.access.setAccountToken('b'.repeat(64));
    expect(browser.value(policyKey)).toBeUndefined();
    browser.access.setAccountDailyAttemptPolicy({ maxAttempts: 7 });
    expect(browser.access.getAccountDailyAttemptPolicy()).toEqual({ maxAttempts: 7 });
    browser.access.clearAccountToken();
    expect(browser.value(policyKey)).toBeUndefined();

    expect(() => browser.access.setAccountToken('invalid')).toThrow(/64 caracteres hexadecimales/);
  });

  it('fails safely for malformed policy data and newly generated local accounts', () => {
    const browser = runtime({ [policyKey]: '{not-json' });
    expect(browser.access.getAccountDailyAttemptPolicy()).toBeNull();

    browser.access.setAccountDailyAttemptPolicy('invalid');
    expect(browser.value(policyKey)).toBeUndefined();
    browser.access.setAccountDailyAttemptPolicy({ nested: 1n });
    expect(browser.value(policyKey)).toBeUndefined();

    browser.access.setAccountDailyAttemptPolicy({ maxAttempts: 6 });
    const generated = browser.access.getAccountToken(true);
    expect(generated).toMatch(/^[a-f0-9]{64}$/);
    expect(browser.value(policyKey)).toBeUndefined();
  });
});
