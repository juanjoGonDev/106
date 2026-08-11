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
  const documentListeners = new Map();
  let observerCallback = () => {};
  let structuralStateChange = () => {};
  let currentGate = gate;
  let drained = 0;
  const onMutation = () => observerCallback();
  const homeInput = createObservedBoolean(false, onMutation);
  const startButton = createObservedBoolean(startDisabled, onMutation);
  const captchaContainer = createObservedBoolean(false, onMutation);
  const status = { textContent: '' };
  const validation = { reason: null, valid: true, normalized: '' };

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
    addEventListener(type, callback) {
      documentListeners.set(type, callback);
    },
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
        resolveNicknameGate: (state) => typeof currentGate === 'function' ? currentGate(state) : currentGate,
        validateNickname: () => validation,
      },
      Minuto106NicknameFieldController: {
        bindStructural({ onStateChange }) {
          structuralStateChange = onStateChange ?? (() => {});
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
      expect(drained).toBeLessThan(20);
      microtasks.shift()();
    }
  }

  drainMicrotasks();

  return {
    captchaContainer,
    get drained() { return drained; },
    homeInput,
    ownerSetsStartDisabled(nextValue) {
      startButton.disabled = nextValue;
      drainMicrotasks();
    },
    settlePlayerContext(detail) {
      documentListeners.get('minuto106:player-context')?.({ detail });
      drainMicrotasks();
    },
    setGate(nextGate) {
      currentGate = nextGate;
      observerCallback();
      drainMicrotasks();
    },
    startButton,
    structuralRefresh(nextValidation) {
      Object.assign(validation, nextValidation);
      structuralStateChange(validation);
      drainMicrotasks();
    },
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

  it('keeps a settled server context when blur refreshes the same normalized nick', () => {
    const resolveGate = ({ validation, remoteAvailability, remotePending }) => {
      const allowed = validation.valid && remoteAvailability === 'available' && !remotePending;
      return { captchaAllowed: allowed, reason: allowed ? null : 'availability_pending', startAllowed: allowed };
    };
    const result = runGuard({ gate: resolveGate });

    result.structuralRefresh({ valid: true, reason: null, normalized: 'E2EPlayer' });
    expect(result.startButton.disabled).toBe(true);

    result.settlePlayerContext({ availability: 'available', pending: false });
    result.ownerSetsStartDisabled(false);
    expect(result.startButton.disabled).toBe(false);

    // bindStructural refreshes on change/blur as well as input. The nickname did not
    // change, so the already-settled remote result must remain authoritative.
    result.structuralRefresh({ valid: true, reason: null, normalized: 'E2EPlayer' });
    expect(result.startButton.disabled).toBe(false);
  });
});