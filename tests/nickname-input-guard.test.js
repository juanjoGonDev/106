import { readFileSync } from 'node:fs';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

const source = readFileSync('public/nickname-input-guard.js', 'utf8');

function createObservedBoolean(initialValue, onMutation) {
  let value = initialValue;
  let observed = false;
  let writes = 0;
  let customValidity = '';
  const attributes = new Map();

  return {
    attributes,
    addEventListener() {},
    focus() {},
    reportValidity() {},
    setAttribute(name, nextValue) {
      attributes.set(name, String(nextValue));
    },
    setCustomValidity(nextValue) {
      customValidity = String(nextValue);
    },
    observe() {
      observed = true;
    },
    get customValidity() {
      return customValidity;
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

function runGuard({ gate, startDisabled = false } = {}) {
  const microtasks = [];
  let observerCallback = () => {};
  let currentGate = gate;
  let drained = 0;
  const onMutation = () => observerCallback();
  const homeInput = createObservedBoolean(false, onMutation);
  const startButton = createObservedBoolean(startDisabled, onMutation);
  const captchaContainer = createObservedBoolean(false, onMutation);
  const status = { textContent: '' };
  const validation = { reason: null, valid: true };

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
        resolveNicknameGate: () => currentGate,
        validateNickname: () => validation,
      },
      Minuto106NicknameFieldController: {
        bindStructural({ onStateChange }) {
          const controller = {
            getValidation: () => validation,
            refresh: () => validation,
          };
          onStateChange?.(validation);
          return controller;
        },
      },
    },
    location: { href: 'http://127.0.0.1:3000/' },
    queueMicrotask(callback) {
      microtasks.push(callback);
    },
    window: {},
  });

  function drainMicrotasks() {
    while (microtasks.length) {
      drained += 1;
      expect(drained).toBeLessThan(10);
      microtasks.shift()();
    }
  }

  drainMicrotasks();

  return {
    captchaContainer,
    get drained() { return drained; },
    homeInput,
    setGate(nextGate) {
      currentGate = nextGate;
      observerCallback();
      drainMicrotasks();
    },
    startButton,
  };
}

describe('nickname input guard observer stability', () => {
  it('settles observed button and CAPTCHA state without a microtask feedback loop', () => {
    const result = runGuard({
      gate: { captchaAllowed: false, reason: null, startAllowed: false },
    });

    expect(result.startButton.writes).toBe(1);
    expect(result.captchaContainer.writes).toBe(1);
    expect(result.drained).toBe(2);
  });

  it('does not enable a button disabled by competition or daily-limit state', () => {
    const result = runGuard({
      gate: { captchaAllowed: true, reason: null, startAllowed: true },
      startDisabled: true,
    });

    expect(result.startButton.disabled).toBe(true);
    expect(result.startButton.writes).toBe(0);
    expect(result.drained).toBe(0);
  });

  it('clears stale remote validity when a structurally valid nick becomes eligible', () => {
    const result = runGuard({
      gate: { captchaAllowed: false, reason: 'availability_pending', startAllowed: false },
    });

    expect(result.homeInput.customValidity).toBe('invalid');
    expect(result.homeInput.attributes.get('aria-invalid')).toBe('true');

    result.setGate({ captchaAllowed: true, reason: null, startAllowed: true });

    expect(result.homeInput.customValidity).toBe('');
    expect(result.homeInput.attributes.get('aria-invalid')).toBe('false');
  });
});
