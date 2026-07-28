import assert from 'node:assert/strict';
import test from 'node:test';

import { AuthCaptcha } from '../public/auth-captcha.js';

function container() {
  return {
    hidden: true,
    replaceChildren() {},
  };
}

function renderer(token) {
  return {
    render(_container, options) {
      queueMicrotask(() => options.callback(token));
      return 106;
    },
    remove() {},
  };
}

test('uses browser window and document defaults with and without an injected document', async () => {
  const priorWindow = globalThis.window;
  const priorDocument = globalThis.document;
  try {
    globalThis.window = { turnstile: renderer('ready-token') };
    globalThis.document = { querySelector() { throw new Error('must not load'); } };
    assert.equal(await new AuthCaptcha('site-key', container()).token(), 'ready-token');
    assert.equal(await new AuthCaptcha(null, container()).token(), '');

    globalThis.window.turnstile = null;
    const injectedDocument = {
      querySelector() {
        globalThis.window.turnstile = renderer('injected-document-token');
        return { dataset: { loaded: 'true' } };
      },
    };
    assert.equal(
      await new AuthCaptcha('site-key', container(), { document: injectedDocument }).token(),
      'injected-document-token',
    );

    globalThis.window.turnstile = null;
    globalThis.document = {
      querySelector() {
        globalThis.window.turnstile = renderer('global-document-token');
        return { dataset: { loaded: 'true' } };
      },
    };
    assert.equal(await new AuthCaptcha('site-key', container()).token(), 'global-document-token');
  } finally {
    globalThis.window = priorWindow;
    globalThis.document = priorDocument;
  }
});