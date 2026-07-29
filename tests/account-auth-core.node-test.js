import assert from 'node:assert/strict';
import test from 'node:test';

import {
  authIdentity,
  bearerToken,
  errorMessage,
  errorStatus,
  normalizeAction,
  normalizeDeviceId,
  normalizeEmail,
  normalizeFingerprint,
  normalizePrivateToken,
  normalizeProvider,
  normalizeUuid,
  publicAuth,
  successfulSync,
} from '../supabase/functions/account-auth/core.js';

const uuid = '11111111-1111-4111-8111-111111111111';
const token = 'a'.repeat(64);

test('normalizes account-auth actions, bearer tokens and identifiers', () => {
  for (const action of ['session', 'sync-account', 'confirm-merge', 'cancel-merge']) {
    assert.equal(normalizeAction(` ${action} `), action);
  }
  assert.equal(normalizeAction('unknown'), '');
  assert.equal(normalizeAction(null), '');

  assert.equal(bearerToken('Bearer jwt.token'), 'jwt.token');
  assert.equal(bearerToken('bearer ABC'), 'ABC');
  assert.equal(bearerToken('Basic ABC'), '');
  assert.equal(bearerToken(null), '');

  assert.equal(normalizePrivateToken(` ${token.toUpperCase()} `), token);
  assert.equal(normalizePrivateToken('bad'), '');
  assert.equal(normalizePrivateToken(null), '');
  assert.equal(normalizeFingerprint(token.toUpperCase()), token);
  assert.equal(normalizeFingerprint('bad'), '');
  assert.equal(normalizeFingerprint(null), '');

  assert.equal(normalizeUuid(uuid.toUpperCase()), uuid);
  assert.equal(normalizeUuid('bad'), '');
  assert.equal(normalizeUuid(null), '');

  assert.equal(normalizeDeviceId('valid-device-id-1234'), 'valid-device-id-1234');
  assert.equal(normalizeDeviceId('short'), '');
  assert.equal(normalizeDeviceId('invalid device identifier that contains spaces'), '');
  assert.equal(normalizeDeviceId(null), '');
});

test('normalizes supported provider identity and private email data', () => {
  assert.equal(normalizeProvider(' GOOGLE '), 'google');
  assert.equal(normalizeProvider('facebook'), 'facebook');
  assert.equal(normalizeProvider('github'), 'email');
  assert.equal(normalizeProvider(null), 'email');

  assert.equal(normalizeEmail(' User@Example.com '), 'User@Example.com');
  assert.equal(normalizeEmail('invalid'), '');
  assert.equal(normalizeEmail(null), '');

  assert.equal(authIdentity(null), null);
  assert.equal(authIdentity({ id: 'bad' }), null);
  assert.deepEqual(authIdentity({
    id: uuid,
    email: 'user@example.com',
    email_confirmed_at: '2026-01-01',
    app_metadata: { provider: 'google' },
  }), {
    id: uuid,
    provider: 'google',
    email: 'user@example.com',
    emailVerified: true,
  });
  assert.deepEqual(authIdentity({ id: uuid, app_metadata: {} }), {
    id: uuid,
    provider: 'email',
    email: '',
    emailVerified: false,
  });
});

test('maps every public account-auth error without leaking internals', () => {
  assert.equal(errorStatus('invalid_input'), 400);
  assert.equal(errorStatus('merge_proposal_mismatch'), 400);
  assert.equal(errorStatus('auth_required'), 401);
  assert.equal(errorStatus('invalid_session'), 401);
  assert.equal(errorStatus('merge_proposal_not_found'), 404);
  assert.equal(errorStatus('merge_proposal_expired'), 409);
  assert.equal(errorStatus('merge_proposal_cancelled'), 409);
  assert.equal(errorStatus('merge_proposal_stale'), 409);
  assert.equal(errorStatus('other'), 400);

  assert.equal(errorMessage('invalid_input'), 'Los datos de autenticación no son válidos.');
  assert.equal(errorMessage('auth_required'), 'Inicia sesión para continuar.');
  assert.equal(errorMessage('invalid_session'), 'La sesión ha caducado o no es válida.');
  assert.equal(errorMessage('account_not_found'), 'No se encontró la cuenta de juego.');
  assert.equal(errorMessage('merge_proposal_not_found'), 'La propuesta de vinculación no existe.');
  assert.equal(errorMessage('merge_proposal_expired'), 'La propuesta ha caducado. Vuelve a iniciar la vinculación.');
  assert.equal(errorMessage('merge_proposal_cancelled'), 'La propuesta ya fue cancelada.');
  assert.equal(errorMessage('merge_proposal_mismatch'), 'La confirmación no coincide con el análisis mostrado.');
  assert.equal(errorMessage('merge_proposal_stale'), 'Los datos cambiaron antes de confirmar. Revisa el análisis actualizado.');
  assert.equal(errorMessage('other'), 'No se pudo completar la vinculación de la cuenta.');
});

test('returns only public auth fields and conditionally emits a new account token', () => {
  const identity = {
    id: uuid,
    provider: 'google',
    email: 'user@example.com',
    emailVerified: true,
  };
  assert.deepEqual(publicAuth(identity), {
    provider: 'google',
    email: 'user@example.com',
    emailVerified: true,
  });
  assert.deepEqual(successfulSync({ linked: true, issueToken: false }, token, identity), {
    linked: true,
    issueToken: false,
    auth: publicAuth(identity),
  });
  assert.deepEqual(successfulSync({ linked: true, issueToken: true }, token, identity), {
    linked: true,
    issueToken: true,
    auth: publicAuth(identity),
    accountToken: token,
  });
  assert.deepEqual(successfulSync(null, token, identity), {
    auth: publicAuth(identity),
  });
});
