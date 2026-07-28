import assert from 'node:assert/strict';
import test from 'node:test';

import { AUTH_PENDING_CONFIRMATION_STORAGE_KEY } from '../public/auth-account-state.js';
import {
  browserAuthExperience,
  localAccountSnapshot,
  locationHasVerificationToken,
  redirectToAuthRoute,
} from '../public/auth-browser-context.js';
import { AUTH_ROUTES } from '../public/auth-experience-state.js';
import { pendingConfirmationEmail } from '../public/auth-pending-confirmation.js';

const config = {
  supabaseUrl: 'https://project.supabase.co',
  supabasePublishableKey: `sb_publishable_${'a'.repeat(24)}`,
  accountAuthApiUrl: 'https://project.supabase.co/functions/v1/account-auth',
  publicSiteUrl: 'https://example.com/106',
};

function memoryStorage(values = {}) {
  const entries = new Map(Object.entries(values));
  return {
    getItem(key) { return entries.get(key) ?? null; },
  };
}

test('reads local ownership without creating a private account', () => {
  const calls = [];
  const snapshot = localAccountSnapshot({
    getAccountToken(create) { calls.push(create); return 'a'.repeat(64); },
    getRememberedNicks() { return ['Ana']; },
    getLegacyLocalNicks() { return ['legacy']; },
  });
  assert.deepEqual({ ...snapshot, rememberedNicks: [...snapshot.rememberedNicks], legacyNicks: [...snapshot.legacyNicks] }, {
    accountToken: 'a'.repeat(64),
    rememberedNicks: ['Ana'],
    legacyNicks: ['legacy'],
  });
  assert.deepEqual(calls, [false]);
  assert.ok(Object.isFrozen(snapshot));
  assert.deepEqual({ ...localAccountSnapshot(null), rememberedNicks: [], legacyNicks: [] }, {
    accountToken: '', rememberedNicks: [], legacyNicks: [],
  });
  assert.deepEqual({ ...localAccountSnapshot({ getRememberedNicks: () => 'bad', getLegacyLocalNicks: () => null }), rememberedNicks: [], legacyNicks: [] }, {
    accountToken: '', rememberedNicks: [], legacyNicks: [],
  });
});

test('reads pending confirmation and verification links defensively', () => {
  assert.equal(pendingConfirmationEmail(memoryStorage({ [AUTH_PENDING_CONFIRMATION_STORAGE_KEY]: 'User@example.com' })), 'user@example.com');
  assert.equal(pendingConfirmationEmail(null), '');
  assert.equal(locationHasVerificationToken({ href: 'https://example.com/verificar-email.html?token_hash=abc' }), true);
  assert.equal(locationHasVerificationToken({ href: 'https://example.com/verificar-email.html' }), false);
  assert.equal(locationHasVerificationToken('not a valid absolute url'), false);
  assert.equal(locationHasVerificationToken({ href: 'http://[' }), false);
});

test('resolves browser experience from session, route, local account and pending email', async () => {
  const client = { currentSession: async () => null };
  const experience = await browserAuthExperience({
    client,
    config,
    access: { getAccountToken: () => 'a'.repeat(64) },
    storage: memoryStorage(),
    location: { pathname: '/106/login.html', href: 'https://example.com/106/login.html' },
  });
  assert.equal(experience.redirect, AUTH_ROUTES.account);

  const pending = await browserAuthExperience({
    client: null,
    config,
    access: null,
    storage: memoryStorage({ [AUTH_PENDING_CONFIRMATION_STORAGE_KEY]: 'User@example.com' }),
    location: { pathname: '/106/verificar-email.html', href: 'https://example.com/106/verificar-email.html' },
  });
  assert.equal(pending.mode, 'verify');
  assert.equal(pending.pendingEmail, 'user@example.com');

  const cleanLink = await browserAuthExperience({
    client: null,
    config,
    access: null,
    storage: memoryStorage(),
    location: {
      pathname: '/106/verificar-email.html',
      href: 'https://example.com/106/verificar-email.html?token_hash=valid-token',
    },
  });
  assert.equal(cleanLink.mode, 'verify');
  assert.equal(cleanLink.redirect, '');
});

test('redirects only when the target differs from the current route', () => {
  const replacements = [];
  const location = {
    href: 'https://example.com/106/login.html',
    replace(value) { replacements.push(value); },
  };
  assert.equal(redirectToAuthRoute({ redirect: '' }, config, location), false);
  assert.equal(redirectToAuthRoute({ redirect: AUTH_ROUTES.account }, config, location), true);
  assert.deepEqual(replacements, ['https://example.com/106/cuenta.html']);

  const same = {
    href: 'https://example.com/106/cuenta.html',
    replace() { throw new Error('must not redirect'); },
  };
  assert.equal(redirectToAuthRoute({ redirect: AUTH_ROUTES.account }, config, same), false);
});