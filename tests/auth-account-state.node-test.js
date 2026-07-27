import assert from 'node:assert/strict';
import test from 'node:test';

import {
  accountRedirectUrl,
  mergeItemText,
  neutralAuthMessage,
  normalizeAuthConfig,
  normalizeEmail,
  normalizeMergeImpact,
  normalizeProvider,
  passwordProblems,
  sessionSummary,
} from '../public/auth-account-state.js';

const publishableKey = `sb_publishable_${'a'.repeat(24)}`;

test('normalizes complete, local and unavailable auth configuration', () => {
  assert.deepEqual(normalizeAuthConfig({
    supabaseUrl: ' https://project.supabase.co/ ',
    supabasePublishableKey: publishableKey,
    accountAuthApiUrl: 'https://project.supabase.co/functions/v1/account-auth/',
    publicSiteUrl: 'https://example.com/app/',
    turnstileSiteKey: ' turnstile ',
  }), {
    available: true,
    supabaseUrl: 'https://project.supabase.co',
    publishableKey,
    accountAuthApiUrl: 'https://project.supabase.co/functions/v1/account-auth',
    publicSiteUrl: 'https://example.com/app',
    turnstileSiteKey: 'turnstile',
  });

  const local = normalizeAuthConfig({
    supabaseUrl: 'http://127.0.0.1:54321',
    supabasePublishableKey: `eyJ${'x'.repeat(24)}`,
    accountAuthApiUrl: 'http://127.0.0.1:54321/functions/v1/account-auth',
  });
  assert.equal(local.available, true);
  assert.equal(normalizeAuthConfig(null).available, false);
  assert.equal(normalizeAuthConfig({ supabaseUrl: 'https://evil.example', supabasePublishableKey: 'bad' }).available, false);
  assert.equal(normalizeAuthConfig({ supabaseUrl: 'http://localhost:54321', supabasePublishableKey: publishableKey }).available, false);
});

test('validates providers, email and password policy exhaustively', () => {
  assert.equal(normalizeProvider(' GOOGLE '), 'google');
  assert.equal(normalizeProvider('facebook'), 'facebook');
  assert.equal(normalizeProvider('x'), '');
  assert.equal(normalizeProvider(null), '');

  assert.equal(normalizeEmail(' User@Example.com '), 'user@example.com');
  assert.equal(normalizeEmail('invalid'), '');
  assert.equal(normalizeEmail(`${'a'.repeat(310)}@example.com`), '');
  assert.equal(normalizeEmail(null), '');

  assert.deepEqual(passwordProblems(''), [
    'Usa al menos 12 caracteres.',
    'Añade una letra minúscula.',
    'Añade una letra mayúscula.',
    'Añade un número.',
    'Añade un símbolo.',
  ]);
  assert.deepEqual(passwordProblems('abcdefghijkl'), [
    'Añade una letra mayúscula.',
    'Añade un número.',
    'Añade un símbolo.',
  ]);
  assert.deepEqual(passwordProblems('ABCDEFGHIJKL'), [
    'Añade una letra minúscula.',
    'Añade un número.',
    'Añade un símbolo.',
  ]);
  assert.deepEqual(passwordProblems('Abcdefghijkl'), [
    'Añade un número.',
    'Añade un símbolo.',
  ]);
  assert.deepEqual(passwordProblems('Abcdefghijk1'), ['Añade un símbolo.']);
  assert.deepEqual(passwordProblems('Abcdefghij1!'), []);
  assert.deepEqual(passwordProblems(null), passwordProblems(''));
});

test('builds callback URLs and neutral auth responses without account enumeration', () => {
  assert.equal(accountRedirectUrl('https://example.com/app/'), 'https://example.com/app/cuenta.html');
  assert.equal(accountRedirectUrl('https://example.com/app/', 'cuenta.html'), 'https://example.com/app/cuenta.html');
  assert.equal(accountRedirectUrl('https://example.com/app', '/restablecer-clave.html'), 'https://example.com/app/restablecer-clave.html');
  assert.equal(neutralAuthMessage('signup'), 'Revisa tu correo para confirmar la cuenta. Si la dirección ya estaba registrada, no se realizará ningún cambio.');
  assert.equal(neutralAuthMessage('recovery'), 'Si existe una cuenta asociada, recibirás un correo con los siguientes pasos.');
  assert.equal(neutralAuthMessage('signin', 'invalid login credentials'), 'El email o la contraseña no son correctos.');
  assert.equal(neutralAuthMessage('signin', 'invalid_credentials'), 'El email o la contraseña no son correctos.');
  assert.equal(neutralAuthMessage('signin', 'Email not confirmed'), 'Confirma tu correo antes de iniciar sesión.');
  assert.equal(neutralAuthMessage('signin', 'captcha_failed'), 'No se pudo completar la verificación anti-bots. Inténtalo de nuevo.');
  assert.equal(neutralAuthMessage('signin', 'rate limit'), 'Demasiados intentos seguidos. Espera un momento.');
  assert.equal(neutralAuthMessage('signin', 'too many requests'), 'Demasiados intentos seguidos. Espera un momento.');
  assert.equal(neutralAuthMessage('other'), 'No se pudo completar la autenticación. Inténtalo de nuevo.');
});

test('normalizes and formats every merge-impact category', () => {
  const impact = normalizeMergeImpact({
    leagues: [{ name: 'Liga A', publicId: 'ABC123' }, null, 'invalid'],
    trophies: [{ title: 'Campeón', nick: 'Ana' }],
    achievements: [{ title: 'Retador', nick: 'Luis' }],
    duels: [{ id: 'd1', challenger: 'Ana', opponent: 'Luis' }],
    referrals: [{ id: 'r1', referrer: 'Ana', referred: 'Luis' }],
    bonusAdjustments: [{ nick: 'Ana', attempts: 3 }],
    totalLosses: 9,
  });
  assert.equal(impact.sections.length, 6);
  assert.equal(impact.sections[0].items.length, 1);
  assert.equal(impact.totalLosses, 9);
  assert.equal(normalizeMergeImpact({ leagues: [{}] }).totalLosses, 1);
  assert.equal(normalizeMergeImpact({ totalLosses: -4 }).totalLosses, 0);
  assert.equal(normalizeMergeImpact(null).totalLosses, 0);
  assert.equal(normalizeMergeImpact({ leagues: 'invalid' }).sections[0].items.length, 0);

  assert.equal(mergeItemText({ title: 'Campeón', nick: 'Ana' }), 'Campeón · Ana');
  assert.equal(mergeItemText({ name: 'Liga A', publicId: 'ABC123' }), 'Liga A · ABC123');
  assert.equal(mergeItemText({ challenger: 'Ana', opponent: 'Luis' }), 'Ana contra Luis');
  assert.equal(mergeItemText({ referrer: 'Ana', referred: 'Luis' }), 'Ana invitó a Luis');
  assert.equal(mergeItemText({ nick: 'Ana', attempts: 3 }), 'Ana: −3 intentos extra');
  assert.equal(mergeItemText({ title: 'Título' }), 'Título');
  assert.equal(mergeItemText({ name: 'Nombre' }), 'Nombre');
  assert.equal(mergeItemText({ challenger: 'Ana' }), 'Elemento competitivo');
  assert.equal(mergeItemText({ referrer: 'Ana' }), 'Elemento competitivo');
  assert.equal(mergeItemText({ nick: 'Ana', attempts: 'not-a-number' }), 'Elemento competitivo');
  assert.equal(mergeItemText({ code: 'code' }), 'code');
  assert.equal(mergeItemText({ id: 'id' }), 'id');
  assert.equal(mergeItemText({}), 'Elemento competitivo');
});

test('summarizes provider sessions and rejects missing users', () => {
  assert.equal(sessionSummary(null), null);
  assert.equal(sessionSummary({}), null);
  assert.equal(sessionSummary({ user: 'invalid' }), null);
  assert.deepEqual(sessionSummary({ user: { email: 'a@example.com', email_confirmed_at: 'now', app_metadata: { provider: 'google' } } }), {
    email: 'a@example.com', provider: 'google', emailVerified: true,
  });
  assert.deepEqual(sessionSummary({ user: { email: 'b@example.com', app_metadata: { provider: 'facebook' } } }), {
    email: 'b@example.com', provider: 'facebook', emailVerified: false,
  });
  assert.deepEqual(sessionSummary({ user: { app_metadata: { provider: 'github' } } }), {
    email: '', provider: 'email', emailVerified: false,
  });
  assert.deepEqual(sessionSummary({ user: {} }), {
    email: '', provider: 'email', emailVerified: false,
  });
});
