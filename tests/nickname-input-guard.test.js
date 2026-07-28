import { readFileSync } from 'node:fs';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

const source = readFileSync('public/nickname-input-guard.js', 'utf8');

function createObservedBoolean(initialValue, onMutation) {
  let value = initialValue;
  let observed = false;
  let writes = 0;

  return {
    addEventListener() {},
    focus() {},
    reportValidity() {},
    setAttribute() {},
    setCustomValidity() {},
    observe() {
      observed = true;
    },
    get writes() {
      return writes;
    },
    get value() {
      return '';
    },
    get disabled() {
      return value;
    },
    set disabled(nextValue) {
      value = nextValue;
      writes += 1;
      if (observed) onMutation();
    },
    get hidden() {
      return value;
    },
    set hidden(nextValue) {
      value = nextValue;
      writes += 1;
      if (observed) onMutation();
    },
  };
}

describe('nickname input guard observer stability', () => {
  it('settles observed button and CAPTCHA state without a microtask feedback loop', () => {
    const microtasks = [];
    let observerCallback = () => {};
    const onMutation = () => observerCallback();
    const homeInput = createObservedBoolean(false, onMutation);
    const startButton = createObservedBoolean(false, onMutation);
    const captchaContainer = createObservedBoolean(false, onMutation);
    const status = { textContent: '' };

    const elements = new Map([
      ['#nick', homeInput],
      ['#startButton', startButton],
      ['#nickStatus', status],
      ['#turnstileContainer', captchaContainer],
    ]);

    class MutationObserverStub {
      constructor(callback) {
        observerCallback = callback;
      }

      observe(target) {
        target.observe();
      }
    }

    const document = {
      addEventListener() {},
      head: { append() {} },
      querySelector(selector) {
        return elements.get(selector) ?? null;
      },
    };

    vm.runInNewContext(source, {
      URL,
      HTMLScriptElement: class HTMLScriptElement {},
      MutationObserver: MutationObserverStub,
      document,
      globalThis: {
        Minuto106NicknamePolicy: {
          nicknameErrorMessage: () => 'invalid',
          resolveNicknameGate: () => ({ captchaAllowed: false, reason: null, startAllowed: false }),
          validateNickname: () => ({ reason: null, valid: true }),
        },
      },
      location: { href: 'http://127.0.0.1:3000/' },
      queueMicrotask(callback) {
        microtasks.push(callback);
      },
      window: {},
    });

    let drained = 0;
    while (microtasks.length) {
      drained += 1;
      expect(drained).toBeLessThan(10);
      microtasks.shift()();
    }

    expect(startButton.writes).toBe(1);
    expect(captchaContainer.writes).toBe(1);
    expect(drained).toBe(2);
  });
});
