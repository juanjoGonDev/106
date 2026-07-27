import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUTH_CONFIRMATION_LINK_TTL_SECONDS,
  AUTH_RESEND_COOLDOWN_SECONDS,
  PASSWORD_MIN_LENGTH,
  accountRedirectUrl,
  authRewardMessage,
  confirmationResendDelaySeconds,
  mergeItemText,
  neutralAuthMessage,
  normalizeAuthConfig,
  normalizeEmail,
  normalizeMergeImpact,
  normalizeProvider,
  passwordConfirmationProblem,
  passwordProblems,
  passwordRequirements,
  registrationReadiness,
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
  assert.equal(PASSWORD_MIN_LENGTH, 10);
  assert.equal(normalizeProvider(' GOOGLE '), 'google');
  assert.equal(normalizeProvider('facebook'), 'facebook');
  assert.equal(normalizeProvider('x'), '');
  assert.equal(normalizeProvider(null), '');

  assert.equal(normalizeEmail(' User@Example.com '), 'user@example.com');
  assert.equal(normalizeEmail('invalid'), '');
  assert.equal(normalizeEmail(`${'a'.repeat(310)}@example.com`), '');
  assert.equal(normalizeEmail(null), '');

  assert.deepEqual(passwordProblems(''), [
    'Usa al menos 10 caracteres.',
    'Añade una letra minúscula.',
    'Añade una letra mayúscula.',
    'Añade un número.',
    'Añade un símbolo.',
  ]);
  assert.deepEqual(passwordProblems('abcdefghij'), [
    'Añade una letra mayúscula.',
    'Añade un número.',
    'Añade un símbolo.',
  ]);
  assert.deepEqual(passwordProblems('ABCDEFGHIJ'), [
    'Añade una letra minúscula.',
    'Añade un número.',
    'Añade un símbolo.',
  ]);
  assert.deepEqual(passwordProblems('Abcdefghij'), [
    'Añade un número.',
    'Añade un símbolo.',
  ]);
  assert.deepEqual(passwordProblems('Abcdefghi1'), ['Añade un símbolo.']);
  assert.deepEqual(passwordProblems('Abcdefg1!x'), []);
  assert.deepEqual(passwordProblems(null), passwordProblems(''));

  assert.deepEqual(passwordRequirements('Abcdefg1!x').map(({ code, met }) => ({ code, met })), [
    { code: 'length', met: true },
    { code: 'lowercase', met: true },
    { code: 'uppercase', met: true },
    { code: 'number', met: true },
    { code: 'symbol', met: true },
  ]);
  assert.equal(passwordConfirmationProblem('secret', ''), 'Repite la contraseña para confirmar que está bien escrita.');
  assert.equal(passwordConfirmationProblem('secret', 'other'), 'Las contraseñas no coinciden.');
  assert.equal(passwordConfirmationProblem('secret', 'secret'), '');
  assert.equal(passwordConfirmationProblem(null, null), 'Repite la contraseña para confirmar que está bien escrita.');

  assert.deepEqual(registrationReadiness(' User@Example.com ', 'Abcdefg1!x', 'Abcdefg1!x'), {
    ready: true,
    email: 'user@example.com',
    problems: [],
    confirmationProblem: '',
  });
  assert.equal(registrationReadiness('bad', 'short', 'different').ready, false);
});

test('enforces one-hour confirmation expiry and resend cooldown decisions', () => {
  assert.equal(AUTH_CONFIRMATION_LINK_TTL_SECONDS, 3600);
  assert.equal(AUTH_RESEND_COOLDOWN_SECONDS, 60);
  assert.equal(confirmationResendDelaySeconds(61_001, 1_000), 61);
  assert.equal(confirmationResendDelaySeconds(1_001, 1_000), 1);
  assert.equal(confirmationResendDelaySeconds(999, 1_000), 0);
  assert.equal(confirmationResendDelaySeconds('invalid', 1_000), 0);
  assert.equal(confirmationResendDelaySeconds(2_000, Number.NaN), 0);
});

test('builds callback URLs and neutral auth responses without account enumeration', () => {
  assert.equal(accountRedirectUrl('https://example.com/app/'), 'https://example.com/app/cuenta.html');
  assert.equal(accountRedirectUrl('https://example.com/app/', 'cuenta.html'), 'https://example.com/app/cuenta.html');
  assert.equal(accountRedirectUrl('https://example.com/app', '/restablecer-clave.html'), 'https://example.com/app/restablecer-clave.html');
  assert.equal(accountRedirectUrl(null), '/cuenta.html');
  assert.match(neutralAuthMessage('signup'), /próxima hora/);
  assert.match(neutralAuthMessage('signup'), /\+1 intento diario/);
  assert.match(neutralAuthMessage('resend'), /válido durante 1 hora/);
  assert.equal(neutralAuthMessage('recovery'), 'Si existe una cuenta asociada, recibirás un correo con los siguientes pasos.');
  assert.equal(neutralAuthMessage('signin', 'invalid login credentials'), 'El email o la contraseña no son correctos.');
  assert.equal(neutralAuthMessage('signin', 'invalid_credentials'), 'El email o la contraseña no son correctos.');
  assert.match(neutralAuthMessage('signin', 'Email not confirmed'), /Puedes reenviarlo/);
  assert.equal(neutralAuthMessage('signin', 'captcha_failed'), 'No se pudo completar la verificación anti-bots. Inténtalo de nuevo.');
  assert.equal(neutralAuthMessage('signin', 'rate limit'), 'Demasiados intentos seguidos. Espera un momento.');
  assert.equal(neutralAuthMessage('signin', 'too many requests'), 'Demasiados intentos seguidos. Espera un momento.');
  assert.equal(neutralAuthMessage('other'), 'No se pudo completar la autenticación. Inténtalo de nuevo.');
  assert.equal(neutralAuthMessage('other', null), 'No se pudo completar la autenticación. Inténtalo de nuevo.');
});

test('formats every email and social account reward state', () => {
  assert.equal(
    authRewardMessage({ granted: true, source: 'email_confirmation' }),
    'Cuenta confirmada y vinculada. Has recibido +1 intento diario y el logro Cuenta confirmada.',
  );
  assert.match(authRewardMessage({ granted: true, source: 'social_link', provider: 'google' }), /Google/);
  assert.match(authRewardMessage({ granted: true, source: 'social_link', provider: 'facebook' }), /Facebook/);
  assert.match(authRewardMessage({ granted: true, source: 'social_link', provider: 'unknown' }), /Google/);
  assert.match(authRewardMessage({ active: true, source: 'email_confirmation' }), /email confirmado/);
  assert.match(authRewardMessage({ active: true, source: 'social_link' }), /Google y Facebook/);
  assert.match(authRewardMessage({ pendingConfirmation: true }), /Confirma el email/);
  assert.equal(authRewardMessage(null), 'Cuenta vinculada. Tu progreso se puede recuperar iniciando sesión.');
  assert.equal(authRewardMessage({}), 'Cuenta vinculada. Tu progreso se puede recuperar iniciando sesión.');
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
