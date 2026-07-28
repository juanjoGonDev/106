import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUTH_ROUTES,
  authIdentity,
  authRouteUrl,
  localAccountActive,
  normalizeAuthRoute,
  providerAction,
  resolveAuthExperience,
  sessionProviders,
  shouldShowEmailVerification,
} from '../public/auth-experience-state.js';

function session({ provider = 'email', providers, identities, confirmed = false, email = 'user@example.com' } = {}) {
  return {
    user: {
      email,
      email_confirmed_at: confirmed ? '2026-07-28T00:00:00.000Z' : null,
      app_metadata: {
        provider,
        ...(providers ? { providers } : {}),
      },
      ...(identities ? { identities } : {}),
    },
  };
}

test('normalizes known routes and constructs deployment-safe URLs', () => {
  assert.equal(normalizeAuthRoute('/106/login.html?next=x'), AUTH_ROUTES.login);
  assert.equal(normalizeAuthRoute('registro.html#form'), AUTH_ROUTES.register);
  assert.equal(normalizeAuthRoute('/verificar-email.html'), AUTH_ROUTES.verify);
  assert.equal(normalizeAuthRoute('/unknown'), AUTH_ROUTES.account);
  assert.equal(normalizeAuthRoute(null), AUTH_ROUTES.account);
  assert.equal(authRouteUrl('https://example.com/106/', AUTH_ROUTES.login), 'https://example.com/106/login.html');
  assert.equal(authRouteUrl('', AUTH_ROUTES.register), '/registro.html');
  assert.equal(authRouteUrl(null, 'invalid'), '/cuenta.html');
  assert.ok(Object.isFrozen(AUTH_ROUTES));
});

test('derives unique providers from metadata and identities', () => {
  assert.deepEqual([...sessionProviders(null)], []);
  assert.deepEqual([...sessionProviders({ user: 'invalid' })], []);
  assert.deepEqual([...sessionProviders(session({
    provider: 'google',
    providers: ['google', 'facebook', 'google', 'x'],
    identities: [{ provider: 'email' }, { provider: 'facebook' }, null],
  }))], ['google', 'facebook', 'email']);
  assert.deepEqual([...sessionProviders(session({ provider: 'email' }))], ['email']);
});

test('summarizes email and social identities with verification eligibility', () => {
  assert.equal(authIdentity(null), null);
  assert.deepEqual({ ...authIdentity(session()) }, {
    email: 'user@example.com',
    emailVerified: false,
    primaryProvider: 'email',
    providers: ['email'],
    socialProviders: [],
    verificationEligible: true,
  });
  assert.equal(authIdentity(session({ confirmed: true })).verificationEligible, false);
  const social = authIdentity(session({
    provider: 'google',
    providers: ['google', 'facebook'],
    confirmed: false,
  }));
  assert.deepEqual([...social.socialProviders], ['google', 'facebook']);
  assert.equal(social.primaryProvider, 'google');
  assert.equal(social.verificationEligible, false);
});

test('detects local account ownership without creating a token', () => {
  assert.equal(localAccountActive(), false);
  assert.equal(localAccountActive({ accountToken: 'a'.repeat(64) }), true);
  assert.equal(localAccountActive({ accountToken: 'invalid' }), false);
  assert.equal(localAccountActive({ rememberedNicks: ['Ana'] }), true);
  assert.equal(localAccountActive({ rememberedNicks: [] }), false);
  assert.equal(localAccountActive({ legacyNicks: ['ana'] }), true);
  assert.equal(localAccountActive({ legacyNicks: 'invalid' }), false);
});

test('protects login and registration from authenticated and local-account users', () => {
  assert.deepEqual({ ...resolveAuthExperience({ route: AUTH_ROUTES.login }) }, {
    route: AUTH_ROUTES.login,
    redirect: '',
    mode: 'login',
    identity: null,
    pendingEmail: '',
  });
  assert.equal(resolveAuthExperience({ route: AUTH_ROUTES.register }).mode, 'register');
  assert.equal(resolveAuthExperience({ route: AUTH_ROUTES.login, session: session({ confirmed: true }) }).redirect, AUTH_ROUTES.account);
  assert.equal(resolveAuthExperience({ route: AUTH_ROUTES.register, hasLocalAccount: true }).redirect, AUTH_ROUTES.account);
  assert.equal(resolveAuthExperience({ route: AUTH_ROUTES.register, pendingEmail: 'user@example.com' }).redirect, AUTH_ROUTES.verify);
  assert.equal(resolveAuthExperience({ route: AUTH_ROUTES.login, pendingEmail: 'user@example.com' }).mode, 'login');
});

test('protects verification and resolves every account mode', () => {
  assert.equal(resolveAuthExperience({ route: AUTH_ROUTES.verify }).redirect, AUTH_ROUTES.register);
  assert.equal(resolveAuthExperience({ route: AUTH_ROUTES.verify, pendingEmail: 'USER@example.com' }).mode, 'verify');
  assert.equal(resolveAuthExperience({ route: AUTH_ROUTES.verify, pendingEmail: 'USER@example.com' }).pendingEmail, 'user@example.com');
  assert.equal(resolveAuthExperience({ route: AUTH_ROUTES.verify, session: session({ confirmed: true }) }).redirect, AUTH_ROUTES.account);
  assert.equal(resolveAuthExperience({ route: AUTH_ROUTES.verify, session: session(), pendingEmail: '' }).mode, 'verify');
  assert.equal(resolveAuthExperience({ route: AUTH_ROUTES.account }).mode, 'guest');
  assert.equal(resolveAuthExperience({ route: AUTH_ROUTES.account, hasLocalAccount: true }).mode, 'local-link');
  assert.equal(resolveAuthExperience({ route: AUTH_ROUTES.account, hasLocalAccount: true, pendingEmail: 'user@example.com' }).mode, 'pending-email');
  assert.equal(resolveAuthExperience({ route: AUTH_ROUTES.account, session: session({ confirmed: true }) }).mode, 'authenticated');
  assert.equal(resolveAuthExperience({ route: '/unknown' }).route, AUTH_ROUTES.account);
});

test('produces contextual provider actions without duplicating page logic', () => {
  assert.deepEqual({ ...providerAction('x', 'login') }, {
    provider: '', disabled: true, label: 'Proveedor no disponible',
  });
  assert.deepEqual({ ...providerAction('google', 'login') }, {
    provider: 'google', disabled: false, label: 'Continuar con Google',
  });
  assert.equal(providerAction('facebook', 'register').label, 'Crear con Facebook');
  assert.equal(providerAction('google', 'local-link').label, 'Vincular Google');
  assert.equal(providerAction('facebook', 'authenticated').label, 'Vincular Facebook');
  const identity = authIdentity(session({ provider: 'google', providers: ['google'], confirmed: true }));
  assert.deepEqual({ ...providerAction('google', 'authenticated', identity) }, {
    provider: 'google', disabled: true, label: 'Google vinculado',
  });
});

test('shows email verification only for explicit pending or eligible email states', () => {
  assert.equal(shouldShowEmailVerification(null), false);
  assert.equal(shouldShowEmailVerification({ redirect: AUTH_ROUTES.account }), false);
  assert.equal(shouldShowEmailVerification(resolveAuthExperience({ route: AUTH_ROUTES.account, pendingEmail: 'user@example.com' })), true);
  assert.equal(shouldShowEmailVerification(resolveAuthExperience({ route: AUTH_ROUTES.verify, pendingEmail: 'user@example.com' })), true);
  assert.equal(shouldShowEmailVerification(resolveAuthExperience({ route: AUTH_ROUTES.account, session: session() })), true);
  assert.equal(shouldShowEmailVerification(resolveAuthExperience({ route: AUTH_ROUTES.account, session: session({ confirmed: true }) })), false);
  assert.equal(shouldShowEmailVerification(resolveAuthExperience({ route: AUTH_ROUTES.account, session: session({ provider: 'google' }) })), false);
});
