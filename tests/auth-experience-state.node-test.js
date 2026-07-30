import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUTH_ROUTE_ACCESS,
  AUTH_ROUTE_POLICIES,
  AUTH_ROUTES,
  authIdentity,
  authRouteGuardDecision,
  authRoutePolicy,
  authRouteUrl,
  identitySupportsPassword,
  localAccountActive,
  normalizeAuthRoute,
  providerAction,
  resolveAuthExperience,
  sessionAuthenticationMethods,
  sessionProviders,
  shouldShowEmailVerification,
} from '../public/auth-experience-state.js';

const unsupportedSocialProvider = ['face', 'book'].join('');

function accessTokenFromPayload(payload) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.signature`;
}

function accessToken(methods) {
  return accessTokenFromPayload({
    amr: methods.map((method) => ({ method, timestamp: 1_722_470_400 })),
  });
}

function session({
  provider = 'email',
  providers,
  identities,
  confirmed = false,
  email = 'user@example.com',
  authenticationMethods,
} = {}) {
  const methods = authenticationMethods ?? [provider === 'email' ? 'password' : 'oauth'];
  return {
    access_token: accessToken(methods),
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
  assert.equal(normalizeAuthRoute('/restablecer-clave.html'), AUTH_ROUTES.reset);
  assert.equal(normalizeAuthRoute('/unknown'), AUTH_ROUTES.account);
  assert.equal(normalizeAuthRoute(null), AUTH_ROUTES.account);
  assert.equal(authRouteUrl('https://example.com/106/', AUTH_ROUTES.login), 'https://example.com/106/login.html');
  assert.equal(authRouteUrl('', AUTH_ROUTES.register), '/registro.html');
  assert.equal(authRouteUrl(null, 'invalid'), '/cuenta.html');
  assert.ok(Object.isFrozen(AUTH_ROUTES));
});

test('declares immutable route access policies centrally', () => {
  assert.ok(Object.isFrozen(AUTH_ROUTE_ACCESS));
  assert.ok(Object.isFrozen(AUTH_ROUTE_POLICIES));
  for (const policy of Object.values(AUTH_ROUTE_POLICIES)) assert.ok(Object.isFrozen(policy));
  assert.equal(authRoutePolicy(AUTH_ROUTES.account).access, AUTH_ROUTE_ACCESS.contextual);
  assert.equal(authRoutePolicy(AUTH_ROUTES.login).access, AUTH_ROUTE_ACCESS.guestOnly);
  assert.equal(authRoutePolicy(AUTH_ROUTES.verify).access, AUTH_ROUTE_ACCESS.verification);
  assert.equal(authRoutePolicy(AUTH_ROUTES.reset).access, AUTH_ROUTE_ACCESS.recoverySession);
  assert.equal(authRoutePolicy('/unknown').access, AUTH_ROUTE_ACCESS.contextual);
});

test('derives unique supported providers from metadata and identities', () => {
  assert.deepEqual([...sessionProviders(null)], []);
  assert.deepEqual([...sessionProviders({ user: 'invalid' })], []);
  assert.deepEqual([...sessionProviders(session({
    provider: 'google',
    providers: ['google', unsupportedSocialProvider, 'google', 'x'],
    identities: [{ provider: 'email' }, { provider: unsupportedSocialProvider }, null],
  }))], ['google', 'email']);
  assert.deepEqual([...sessionProviders(session({ provider: 'email' }))], ['email']);
  assert.deepEqual([...sessionProviders({ user: { app_metadata: {}, identities: [] } })], []);
});

test('derives authentication methods from the current JWT and fails closed on malformed claims', () => {
  assert.deepEqual([...sessionAuthenticationMethods(null)], []);
  assert.deepEqual([...sessionAuthenticationMethods({ access_token: 'not-a-jwt' })], []);
  assert.deepEqual([...sessionAuthenticationMethods({ access_token: 'header..signature' })], []);
  assert.deepEqual([...sessionAuthenticationMethods({ access_token: 'header.invalid.signature' })], []);
  assert.deepEqual([...sessionAuthenticationMethods({ access_token: accessTokenFromPayload(null) })], []);
  assert.deepEqual([...sessionAuthenticationMethods({ access_token: accessTokenFromPayload({}) })], []);
  assert.deepEqual([...sessionAuthenticationMethods({
    access_token: accessTokenFromPayload({
      amr: [
        { method: ' PASSWORD ' },
        { method: 'oauth' },
        { method: 'password' },
        null,
        {},
        { method: '' },
      ],
    }),
  })], ['password', 'oauth']);
});

test('summarizes email and Google identities with verification eligibility', () => {
  assert.equal(authIdentity(null), null);
  assert.equal(authIdentity(session({ provider: unsupportedSocialProvider })), null);
  assert.deepEqual({ ...authIdentity(session()) }, {
    email: 'user@example.com',
    emailVerified: false,
    primaryProvider: 'email',
    providers: ['email'],
    socialProviders: [],
    authenticationMethods: ['password'],
    verificationEligible: true,
  });
  assert.equal(authIdentity(session({ confirmed: true })).verificationEligible, false);
  const social = authIdentity(session({
    provider: 'google',
    providers: ['google', unsupportedSocialProvider],
    confirmed: false,
  }));
  assert.deepEqual([...social.socialProviders], ['google']);
  assert.deepEqual([...social.authenticationMethods], ['oauth']);
  assert.equal(social.primaryProvider, 'google');
  assert.equal(social.verificationEligible, false);

  const autoLinked = authIdentity(session({
    provider: 'email',
    providers: ['email', 'google'],
    confirmed: false,
  }));
  assert.equal(autoLinked.primaryProvider, 'email');
  assert.deepEqual([...autoLinked.socialProviders], ['google']);
  assert.equal(autoLinked.verificationEligible, false);

  const legacy = authIdentity({
    user: {
      email: 'legacy@example.com',
      email_confirmed_at: null,
      app_metadata: {},
    },
  });
  assert.equal(legacy.primaryProvider, 'email');
  assert.deepEqual([...legacy.providers], []);
  assert.deepEqual([...legacy.authenticationMethods], []);
  assert.equal(legacy.verificationEligible, true);
});

test('allows password change only when the current session authenticated with a password', () => {
  assert.equal(identitySupportsPassword(null), false);
  assert.equal(identitySupportsPassword({}), false);
  assert.equal(identitySupportsPassword({ authenticationMethods: [] }), false);
  assert.equal(identitySupportsPassword({ authenticationMethods: ['oauth'] }), false);
  assert.equal(identitySupportsPassword({ authenticationMethods: ['password'] }), true);
  assert.equal(identitySupportsPassword(authIdentity(session({ confirmed: true }))), true);

  const linkedGoogleSession = authIdentity(session({
    provider: 'email',
    providers: ['email', 'google'],
    identities: [{ provider: 'email' }, { provider: 'google' }],
    confirmed: true,
    authenticationMethods: ['oauth'],
  }));
  assert.equal(linkedGoogleSession.primaryProvider, 'email');
  assert.deepEqual([...linkedGoogleSession.providers], ['email', 'google']);
  assert.equal(identitySupportsPassword(linkedGoogleSession), false);
});

test('detects local account credentials without treating remembered display names as authentication', () => {
  assert.equal(localAccountActive(), false);
  assert.equal(localAccountActive({ accountToken: 'a'.repeat(64) }), true);
  assert.equal(localAccountActive({ accountToken: 'invalid' }), false);
  assert.equal(localAccountActive({ rememberedNicks: ['Ana'] }), false);
  assert.equal(localAccountActive({ rememberedNicks: [] }), false);
  assert.equal(localAccountActive({ legacyNicks: ['ana'] }), true);
  assert.equal(localAccountActive({ legacyNicks: 'invalid' }), false);
});

test('guard decisions protect guest-only routes from cloud and local accounts', () => {
  assert.deepEqual({ ...authRouteGuardDecision({ route: AUTH_ROUTES.login }) }, {
    route: AUTH_ROUTES.login,
    redirect: '',
    identity: null,
    pendingEmail: '',
  });
  assert.equal(authRouteGuardDecision({ route: AUTH_ROUTES.login, session: session({ confirmed: true }) }).redirect, AUTH_ROUTES.account);
  assert.equal(authRouteGuardDecision({ route: AUTH_ROUTES.register, hasLocalAccount: true }).redirect, AUTH_ROUTES.account);
  assert.equal(authRouteGuardDecision({ route: AUTH_ROUTES.register, pendingEmail: 'USER@example.com' }).redirect, AUTH_ROUTES.verify);
  assert.equal(authRouteGuardDecision({ route: AUTH_ROUTES.login, pendingEmail: 'USER@example.com' }).redirect, '');
});

test('guard decisions protect verification and recovery contexts', () => {
  assert.equal(authRouteGuardDecision({ route: AUTH_ROUTES.verify }).redirect, AUTH_ROUTES.register);
  assert.equal(authRouteGuardDecision({ route: AUTH_ROUTES.verify, hasVerificationToken: true }).redirect, '');
  assert.equal(authRouteGuardDecision({ route: AUTH_ROUTES.verify, pendingEmail: 'USER@example.com' }).pendingEmail, 'user@example.com');
  assert.equal(authRouteGuardDecision({ route: AUTH_ROUTES.verify, session: session() }).redirect, '');
  assert.equal(authRouteGuardDecision({ route: AUTH_ROUTES.verify, session: session({ confirmed: true }) }).redirect, AUTH_ROUTES.account);
  assert.equal(authRouteGuardDecision({ route: AUTH_ROUTES.reset }).redirect, AUTH_ROUTES.login);
  assert.equal(authRouteGuardDecision({ route: AUTH_ROUTES.reset, session: session({ confirmed: true }) }).redirect, '');
  assert.equal(authRouteGuardDecision({ route: AUTH_ROUTES.account }).redirect, '');
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
  assert.equal(resolveAuthExperience({ route: AUTH_ROUTES.verify, hasVerificationToken: true }).mode, 'verify');
  assert.equal(resolveAuthExperience({ route: AUTH_ROUTES.verify, pendingEmail: 'USER@example.com' }).mode, 'verify');
  assert.equal(resolveAuthExperience({ route: AUTH_ROUTES.verify, pendingEmail: 'USER@example.com' }).pendingEmail, 'user@example.com');
  assert.equal(resolveAuthExperience({ route: AUTH_ROUTES.verify, session: session({ confirmed: true }), hasVerificationToken: true }).redirect, AUTH_ROUTES.account);
  assert.equal(resolveAuthExperience({ route: AUTH_ROUTES.verify, session: session(), pendingEmail: '' }).mode, 'verify');
  assert.equal(resolveAuthExperience({ route: AUTH_ROUTES.reset }).redirect, AUTH_ROUTES.login);
  assert.equal(resolveAuthExperience({ route: AUTH_ROUTES.reset, session: session({ confirmed: true }) }).mode, 'password-reset');
  assert.equal(resolveAuthExperience({ route: AUTH_ROUTES.account }).mode, 'guest');
  assert.equal(resolveAuthExperience({ route: AUTH_ROUTES.account, hasLocalAccount: true }).mode, 'local-link');
  assert.equal(resolveAuthExperience({ route: AUTH_ROUTES.account, hasLocalAccount: true, pendingEmail: 'user@example.com' }).mode, 'pending-email');
  const pendingIdentity = resolveAuthExperience({ route: AUTH_ROUTES.account, session: session() });
  assert.equal(pendingIdentity.mode, 'pending-email');
  assert.equal(pendingIdentity.pendingEmail, 'user@example.com');
  assert.equal(resolveAuthExperience({ route: AUTH_ROUTES.account, session: session({ confirmed: true }) }).mode, 'authenticated');
  assert.equal(resolveAuthExperience({ route: '/unknown' }).route, AUTH_ROUTES.account);
});

test('produces contextual Google actions without duplicating page logic', () => {
  assert.deepEqual({ ...providerAction('x', 'login') }, {
    provider: '', disabled: true, label: 'Proveedor no disponible',
  });
  assert.deepEqual({ ...providerAction(unsupportedSocialProvider, 'register') }, {
    provider: '', disabled: true, label: 'Proveedor no disponible',
  });
  assert.deepEqual({ ...providerAction('google', 'login') }, {
    provider: 'google', disabled: false, label: 'Continuar con Google',
  });
  assert.equal(providerAction('google', 'register').label, 'Crear con Google');
  assert.equal(providerAction('google', 'local-link').label, 'Vincular Google');
  assert.equal(providerAction('google', 'authenticated').label, 'Vincular Google');
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
  assert.equal(shouldShowEmailVerification(resolveAuthExperience({ route: AUTH_ROUTES.verify, hasVerificationToken: true })), false);
  assert.equal(shouldShowEmailVerification(resolveAuthExperience({ route: AUTH_ROUTES.account, session: session() })), true);
  assert.equal(shouldShowEmailVerification(resolveAuthExperience({ route: AUTH_ROUTES.account, session: session({ confirmed: true }) })), false);
  assert.equal(shouldShowEmailVerification(resolveAuthExperience({ route: AUTH_ROUTES.account, session: session({ provider: 'google' }) })), false);
});
