import assert from 'node:assert/strict';
import test from 'node:test';

import { AuthCaptcha, loadTurnstileScript } from '../public/auth-captcha.js';

function eventTarget() {
  const listeners = new Map();
  return {
    dataset: {},
    addEventListener(type, callback) { listeners.set(type, callback); },
    emit(type) { listeners.get(type)?.(); },
  };
}

test('loads a new Turnstile script and records successful completion', async () => {
  const script = eventTarget();
  const appended = [];
  const documentValue = {
    querySelector: () => null,
    createElement: (tag) => {
      assert.equal(tag, 'script');
      return script;
    },
    head: { append: (node) => appended.push(node) },
  };
  const promise = loadTurnstileScript(documentValue);
  assert.equal(appended[0], script);
  assert.match(script.src, /challenges\.cloudflare\.com/);
  assert.equal(script.async, true);
  assert.equal(script.defer, true);
  assert.equal(script.dataset.minuto106AuthTurnstile, 'true');
  script.emit('load');
  await promise;
  assert.equal(script.dataset.loaded, 'true');
});

test('reuses loaded or pending scripts and reports loading failure', async () => {
  await loadTurnstileScript({ querySelector: () => ({ dataset: { loaded: 'true' } }) });

  const pending = eventTarget();
  const pendingPromise = loadTurnstileScript({ querySelector: () => pending });
  pending.emit('load');
  await pendingPromise;

  const failing = eventTarget();
  const failingPromise = loadTurnstileScript({ querySelector: () => failing });
  failing.emit('error');
  await assert.rejects(() => failingPromise, /No se pudo cargar/);

  const newFailing = eventTarget();
  const newFailingPromise = loadTurnstileScript({
    querySelector: () => null,
    createElement: () => newFailing,
    head: { append() {} },
  });
  newFailing.emit('error');
  await assert.rejects(() => newFailingPromise, /No se pudo cargar/);
});

test('returns an empty token when captcha is disabled', async () => {
  const captcha = new AuthCaptcha('', null, {
    loadScript: async () => { throw new Error('must not load'); },
    getTurnstile: () => null,
  });
  assert.equal(await captcha.token(), '');
  captcha.reset();
});

test('loads, renders, hides and resets the captcha deterministically', async () => {
  const container = {
    hidden: true,
    replaced: 0,
    replaceChildren() { this.replaced += 1; },
  };
  const removed = [];
  let loaded = false;
  let options;
  const turnstile = {
    render(_container, value) {
      options = value;
      queueMicrotask(() => value.callback('captcha-token'));
      return 106;
    },
    remove(value) { removed.push(value); },
  };
  const captcha = new AuthCaptcha('site-key', container, {
    loadScript: async () => { loaded = true; },
    getTurnstile: () => loaded ? turnstile : null,
  });
  assert.equal(await captcha.token(), 'captcha-token');
  assert.equal(container.hidden, true);
  assert.equal(options.sitekey, 'site-key');
  assert.equal(options.theme, 'dark');
  captcha.reset();
  assert.deepEqual(removed, [106]);
  assert.equal(container.replaced, 1);
  captcha.reset();
  assert.deepEqual(removed, [106]);
  assert.equal(container.replaced, 2);
});

test('supports ready Turnstile and every callback failure', async () => {
  const container = { hidden: true, replaceChildren() {} };
  const run = async (callbackName, message) => {
    const turnstile = {
      render(_container, options) {
        queueMicrotask(() => options[callbackName]());
        return 1;
      },
    };
    const captcha = new AuthCaptcha('site-key', container, {
      loadScript: async () => { throw new Error('must not load'); },
      getTurnstile: () => turnstile,
    });
    await assert.rejects(() => captcha.token(), new RegExp(message));
    assert.equal(container.hidden, true);
  };
  await run('error-callback', 'completar');
  await run('expired-callback', 'caducado');
});

test('fails closed when container or loaded renderer is unavailable', async () => {
  const missingContainer = new AuthCaptcha('site-key', null, {
    getTurnstile: () => null,
  });
  await assert.rejects(() => missingContainer.token(), /preparar/);

  const container = { hidden: true, replaceChildren() {} };
  const missingRenderer = new AuthCaptcha('site-key', container, {
    loadScript: async () => {},
    getTurnstile: () => null,
  });
  await assert.rejects(() => missingRenderer.token(), /cargar/);
  assert.equal(container.hidden, true);
});
