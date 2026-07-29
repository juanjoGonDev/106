import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

import {
  MAX_NICKNAME_LENGTH,
  MIN_NICKNAME_LENGTH,
  nicknameErrorMessage as serverErrorMessage,
  normalizeNickname as normalizeServerNickname,
  validateNickname as validateServerNickname,
} from '../supabase/functions/_shared/nickname-policy.js';

const browserSource = readFileSync(new URL('../public/nickname-policy.js', import.meta.url), 'utf8');

function browserPolicy() {
  const context = { Array, Object, String };
  vm.runInNewContext(browserSource, context, { filename: 'public/nickname-policy.js' });
  return context.Minuto106NicknamePolicy;
}

const validNicknames = [
  ['  Ａna   María  ', 'Ana María'],
  ['Álvaro', 'Álvaro'],
  ['李小雷', '李小雷'],
  ["O'Neil", "O'Neil"],
  ['Jean-Luc', 'Jean-Luc'],
  ['A.B', 'A.B'],
  ['Jugador_106', 'Jugador_106'],
];

const invalidNicknames = [
  [null, 'too_short'],
  ['', 'too_short'],
  ['..', 'too_short'],
  ['A'.repeat(25), 'too_long'],
  ['../..', 'invalid_characters'],
  ['Ana\\Mar', 'invalid_characters'],
  ['Ana😀', 'invalid_characters'],
  ['An\u0000a', 'invalid_characters'],
  ['An\u200ba', 'invalid_characters'],
  ['...', 'invalid_format'],
  ['.Ana', 'invalid_format'],
  ['Ana.', 'invalid_format'],
  ['Ana..Mar', 'invalid_format'],
];

test('browser and server policies normalize compatible multilingual nicknames identically', () => {
  const browser = browserPolicy();
  assert.equal(browser.MIN_LENGTH, MIN_NICKNAME_LENGTH);
  assert.equal(browser.MAX_LENGTH, MAX_NICKNAME_LENGTH);
  assert.equal(browser.normalizeNickname(null), '');
  assert.equal(normalizeServerNickname(null), '');

  for (const [input, normalized] of validNicknames) {
    const browserResult = browser.validateNickname(input);
    const serverResult = validateServerNickname(input);
    assert.deepEqual({ ...browserResult }, { ...serverResult });
    assert.equal(browserResult.valid, true);
    assert.equal(browserResult.normalized, normalized);
    assert.equal(browserResult.key, normalized.toLocaleLowerCase('es'));
    assert.equal(browserResult.reason, null);
  }
});

test('browser and server policies reject traversal, invisible, punctuation-only and boundary inputs identically', () => {
  const browser = browserPolicy();
  for (const [input, reason] of invalidNicknames) {
    const browserResult = browser.validateNickname(input);
    const serverResult = validateServerNickname(input);
    assert.deepEqual({ ...browserResult }, { ...serverResult });
    assert.equal(browserResult.valid, false);
    assert.equal(browserResult.reason, reason);
    assert.equal('key' in browserResult, false);
  }
});

test('all user-facing rejection reasons have deterministic messages', () => {
  const browser = browserPolicy();
  for (const reason of [
    'too_short',
    'too_long',
    'invalid_characters',
    'invalid_format',
    'reserved',
    'offensive',
    'unknown',
  ]) {
    assert.equal(browser.nicknameErrorMessage(reason), serverErrorMessage(reason));
    assert.ok(browser.nicknameErrorMessage(reason).length > 0);
  }
  assert.equal(browser.nicknameErrorMessage('unknown'), 'El nick no es válido.');
  assert.ok(Object.isFrozen(browser));
});

test('gate decisions keep captcha and start unavailable until debounce validates an eligible nickname', () => {
  const browser = browserPolicy();
  const valid = browser.validateNickname('Jugador106');
  const invalid = browser.validateNickname('../..');

  assert.equal(browser.remoteNicknameReason(null), null);
  assert.equal(browser.remoteNicknameReason('available'), null);
  assert.equal(browser.remoteNicknameReason('invalid-reserved'), 'reserved');

  assert.deepEqual({ ...browser.resolveNicknameGate({ validation: invalid }) }, {
    ready: false,
    reason: 'invalid_characters',
    captchaAllowed: false,
    startAllowed: false,
  });
  assert.deepEqual({ ...browser.resolveNicknameGate({ validation: undefined }) }, {
    ready: false,
    reason: 'invalid',
    captchaAllowed: false,
    startAllowed: false,
  });
  assert.equal(browser.resolveNicknameGate({ validation: valid, remotePending: true, remoteAvailability: 'available' }).ready, false);
  assert.equal(browser.resolveNicknameGate({ validation: valid, remoteAvailability: 'unknown' }).ready, false);
  assert.equal(browser.resolveNicknameGate({ validation: valid, remoteAvailability: 'occupied' }).ready, false);
  assert.equal(browser.resolveNicknameGate({ validation: valid, remoteAvailability: 'invalid-offensive' }).reason, 'offensive');
  assert.deepEqual({ ...browser.resolveNicknameGate({ validation: valid, remoteAvailability: 'available' }) }, {
    ready: true,
    reason: null,
    captchaAllowed: true,
    startAllowed: true,
  });
  assert.equal(browser.resolveNicknameGate({ validation: valid, remoteAvailability: 'owned' }).ready, true);
});
