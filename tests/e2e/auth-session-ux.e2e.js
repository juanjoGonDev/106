import { createRequire } from 'node:module';

import { openApplicationPage } from './app-navigation.js';

const runtimePath = process.env.PLAYWRIGHT_TEST_PATH;
if (!runtimePath) throw new Error('PLAYWRIGHT_TEST_PATH is required. Run Playwright through pnpm test:e2e.');
const require = createRequire(import.meta.url);
const { expect, test } = require(runtimePath);

const applicationUrl = 'http://127.0.0.1:3000';
const publishableKey = `sb_publishable_${'a'.repeat(32)}`;
const accountToken = 'b'.repeat(64);
const storedConsent = JSON.stringify({ analytics: false, ads: false, updatedAt: '2026-07-29T00:00:00.000Z' });
const authStorageKeys = [
  'minuto106:supabase-session-v1',
  'minuto106:supabase-pkce-v1',
  'minuto106:supabase-return-v1',
  'minuto106:pending-email-confirmation-v1',
  'minuto106:email-resend-available-at-v1',
  'minuto106:account-access-v1',
  'minuto106:account-nicks-v1',
  'minuto106:player-access-v1',
  'minuto106:nick',
];

function accessToken(authenticationMethod) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({
    amr: [{ method: authenticationMethod, timestamp: 1_722_470_400 }],
  })}.signature`;
}

function cloudSession(provider = 'email', options = {}) {
  const metadataProvider = options.metadataProvider ?? provider;
  const providers = options.providers ?? [provider];
  const authenticationMethod = options.authenticationMethod ?? (provider === 'email' ? 'password' : 'oauth');
  const identities = options.identities ?? providers.map((identityProvider) => ({ provider: identityProvider }));
  return {
    access_token: accessToken(authenticationMethod),
    refresh_token: 'refresh-token',
    expires_at: 2_000_000_000,
    token_type: 'bearer',
    user: {
      id: '11111111-1111-4111-8111-111111111111',
      email: 'player@example.com',
      email_confirmed_at: '2026-07-29T00:00:00.000Z',
      app_metadata: { provider: metadataProvider, providers },
      identities,
    },
  };
}

function requestBody(request) {
  try {
    return request.postDataJSON() || {};
  } catch {
    return {};
  }
}

async function installRuntime(page, { logoutStatus = 204, authLog = [] } = {}) {
  await page.route('**/config.js', (route) => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: `window.__MINUTO106_CONFIG__ = ${JSON.stringify({
      apiBaseUrl: 'https://project.supabase.co/functions/v1/game-api',
      accountAuthApiUrl: 'https://project.supabase.co/functions/v1/account-auth',
      supabaseUrl: 'https://project.supabase.co',
      supabasePublishableKey: publishableKey,
      turnstileSiteKey: '',
      publicSiteUrl: applicationUrl,
    })};`,
  }));

  await page.route('**/auth/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const body = requestBody(request);
    authLog.push({ path: url.pathname, search: url.search, method: request.method(), body });
    if (url.pathname.endsWith('/logout')) {
      await route.fulfill(logoutStatus === 204
        ? { status: 204, body: '' }
        : { status: logoutStatus, contentType: 'application/json', body: JSON.stringify({ message: 'logout unavailable' }) });
      return;
    }
    if (url.pathname.endsWith('/token') && ['password', 'pkce'].includes(url.searchParams.get('grant_type'))) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cloudSession()) });
      return;
    }
    if (url.pathname.endsWith('/recover')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      return;
    }
    if (url.pathname.endsWith('/user') && request.method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cloudSession().user) });
      return;
    }
    if (url.pathname.endsWith('/user') && request.method() === 'PUT') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cloudSession().user) });
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Unexpected auth request' }) });
  });

  await page.route('**/functions/v1/account-auth', async (route) => {
    const body = requestBody(route.request());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body.action === 'sync-account'
        ? { linked: true, accountToken, authReward: { active: false } }
        : {}),
    });
  });

  await page.route('**/functions/v1/player-context', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ availability: 'unknown', profile: null, leagues: [] }),
  }));

  await page.route('**/functions/v1/game-api', async (route) => {
    const body = requestBody(route.request());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body.action === 'account-players' ? { exists: true, players: [] } : {}),
    });
  });
}

async function installStorage(page, { session = null, pendingEmail = '', token = '', complete = false } = {}) {
  await page.addInitScript(({ consent, storedSession, email, accountKey, includeCompleteState }) => {
    const seedKey = 'minuto106:test-auth-storage-seeded';
    if (sessionStorage.getItem(seedKey) === 'true') return;
    sessionStorage.setItem(seedKey, 'true');
    localStorage.setItem('minuto106:consent-v1', consent);
    if (storedSession) localStorage.setItem('minuto106:supabase-session-v1', JSON.stringify(storedSession));
    if (email) {
      localStorage.setItem('minuto106:pending-email-confirmation-v1', email);
      localStorage.setItem('minuto106:email-resend-available-at-v1', '2000000000000');
    }
    if (accountKey) localStorage.setItem('minuto106:account-access-v1', accountKey);
    if (includeCompleteState) {
      localStorage.setItem('minuto106:supabase-pkce-v1', 'stale-pkce');
      localStorage.setItem('minuto106:supabase-return-v1', 'registro.html');
      localStorage.setItem('minuto106:account-nicks-v1', JSON.stringify({ crono: 'Crono' }));
      localStorage.setItem('minuto106:player-access-v1', JSON.stringify({ crono: 'legacy-key' }));
      localStorage.setItem('minuto106:nick', 'Crono');
    }
  }, {
    consent: storedConsent,
    storedSession: session,
    email: pendingEmail,
    accountKey: token,
    includeCompleteState: complete,
  });
}

async function assertNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test('zero-player email account signs out completely and can register or log in again', async ({ page }) => {
  const authLog = [];
  const errors = [];
  const failedRequests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) failedRequests.push(`${response.status()} ${response.url()}`);
  });
  await installRuntime(page, { authLog });
  await installStorage(page, {
    session: cloudSession(),
    pendingEmail: 'stale@example.com',
    token: accountToken,
    complete: true,
  });
  await openApplicationPage(page, '/cuenta.html');

  await expect(page.locator('#cloudAuthenticatedPanel')).toBeVisible();
  await expect(page.locator('#accountPlayersStatus')).toContainText('todavía no tiene nicks');
  await expect(page.locator('#changePasswordLink')).toBeVisible();
  await page.locator('#cloudSignOut').click();
  await expect(page.locator('#appMessageDialog')).toBeVisible();
  await page.locator('#appMessageDialog .app-message-accept').click();

  await expect(page.locator('#cloudAuthenticatedPanel')).toBeHidden();
  await expect(page.locator('#cloudGuestPanel')).toBeVisible();
  await expect(page.locator('#cloudAccountStatus')).toContainText('Sesión cerrada por completo');
  await expect.poll(() => page.evaluate((keys) => Object.fromEntries(keys.map((key) => [key, localStorage.getItem(key)])), authStorageKeys))
    .toEqual(Object.fromEntries(authStorageKeys.map((key) => [key, null])));
  expect(authLog.filter((entry) => entry.path.endsWith('/logout'))).toHaveLength(1);

  await openApplicationPage(page, '/registro.html');
  await expect(page.locator('#authSubmit')).toBeVisible();
  await openApplicationPage(page, '/login.html');
  await page.locator('#authEmail').fill('player@example.com');
  await page.locator('#authPassword').fill('Current123!');
  await page.locator('#authSubmit').click();
  await expect(page).toHaveURL(`${applicationUrl}/cuenta.html`);
  await expect(page.locator('#cloudAuthenticatedPanel')).toBeVisible();
  await assertNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
  expect(failedRequests).toEqual([]);
});

test('remote logout failure still clears every local credential and reports the risk', async ({ page }) => {
  await installRuntime(page, { logoutStatus: 503 });
  await installStorage(page, { session: cloudSession(), token: accountToken, complete: true });
  await openApplicationPage(page, '/cuenta.html');
  await page.locator('#cloudSignOut').click();
  await page.locator('#appMessageDialog .app-message-accept').click();
  await expect(page.locator('#cloudGuestPanel')).toBeVisible();
  await expect(page.locator('#cloudAccountStatus')).toContainText('No se pudo confirmar la revocación remota');
  await expect.poll(() => page.evaluate((keys) => keys.every((key) => localStorage.getItem(key) === null), authStorageKeys)).toBe(true);
});

test('authenticated email change and recovery link reuse the same password page safely', async ({ browser }) => {
  for (const scenario of [
    { mode: 'change', initialSession: cloudSession(), path: '/restablecer-clave.html?mode=change', currentVisible: true },
    { mode: 'recovery', initialSession: null, path: '/restablecer-clave.html?code=recovery&type=recovery', currentVisible: false },
  ]) {
    const context = await browser.newContext({ baseURL: applicationUrl });
    const page = await context.newPage();
    const authLog = [];
    await installRuntime(page, { authLog });
    await installStorage(page, { session: scenario.initialSession });
    if (scenario.mode === 'recovery') {
      await page.addInitScript(() => localStorage.setItem('minuto106:supabase-pkce-v1', 'recovery-verifier'));
    }
    await openApplicationPage(page, scenario.path);

    await expect(page.locator('[data-password-mode]')).toHaveAttribute('data-password-mode', scenario.mode);
    if (scenario.currentVisible) await expect(page.locator('#currentPasswordField')).toBeVisible();
    else await expect(page.locator('#currentPasswordField')).toBeHidden();
    if (scenario.currentVisible) await page.locator('#currentPassword').fill('Current123!');
    await page.locator('#newPassword').fill('NewSecure1!');
    await page.locator('#confirmNewPassword').fill('NewSecure1!');
    await expect(page.locator('#updatePassword')).toBeEnabled();
    await page.locator('#updatePassword').click();
    await expect(page.locator('#passwordResetStatus')).toContainText('Contraseña actualizada');
    const update = authLog.find((entry) => entry.path.endsWith('/user') && entry.method === 'PUT');
    expect(update?.body.password).toBe('NewSecure1!');
    expect(update?.body.current_password).toBe(scenario.currentVisible ? 'Current123!' : undefined);
    await assertNoHorizontalOverflow(page);
    await context.close();
  }
});

test('all password routes use one accessible eye control without changing values', async ({ browser }) => {
  for (const { path, inputs, session } of [
    { path: '/login.html', inputs: ['authPassword'], session: null },
    { path: '/registro.html', inputs: ['authPassword', 'authPasswordConfirmation'], session: null },
    { path: '/restablecer-clave.html?mode=change', inputs: ['currentPassword', 'newPassword', 'confirmNewPassword'], session: cloudSession() },
  ]) {
    const context = await browser.newContext({ baseURL: applicationUrl });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await installRuntime(page);
    await installStorage(page, { session });
    await openApplicationPage(page, path);

    for (const inputId of inputs) {
      const input = page.locator(`#${inputId}`);
      const toggle = page.locator(`button[aria-controls="${inputId}"]`);
      await expect(toggle).toHaveCount(1);
      await expect(toggle).toHaveAccessibleName('Mostrar contraseña');
      await expect(toggle).toHaveAttribute('aria-pressed', 'false');
      await input.fill('Secure123!');
      await input.evaluate((element) => element.setSelectionRange(2, 7));

      await toggle.focus();
      await page.keyboard.press('Enter');
      await expect(input).toHaveAttribute('type', 'text');
      await expect(input).toHaveValue('Secure123!');
      await expect(input).toBeFocused();
      await expect(toggle).toHaveAccessibleName('Ocultar contraseña');
      await expect(toggle).toHaveAttribute('aria-pressed', 'true');
      expect(await input.evaluate((element) => [element.selectionStart, element.selectionEnd])).toEqual([2, 7]);

      await toggle.focus();
      await page.keyboard.press('Space');
      await expect(input).toHaveAttribute('type', 'password');
      await expect(input).toHaveValue('Secure123!');
      await expect(input).toBeFocused();
      await expect(toggle).toHaveAccessibleName('Mostrar contraseña');
      await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    }

    await assertNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
    await context.close();
  }
});

test('direct password management access without a cloud session is guarded', async ({ page }) => {
  await installRuntime(page);
  await installStorage(page);
  await openApplicationPage(page, '/restablecer-clave.html');
  await expect(page).toHaveURL(`${applicationUrl}/login.html`);
  await expect(page.locator('#loginTitle')).toBeVisible();
});

test('Google-authenticated sessions cannot change a password even when an email identity is linked', async ({ browser }) => {
  for (const session of [
    cloudSession('google'),
    cloudSession('google', {
      metadataProvider: 'email',
      providers: ['email', 'google'],
      identities: [{ provider: 'email' }, { provider: 'google' }],
      authenticationMethod: 'oauth',
    }),
  ]) {
    const context = await browser.newContext({ baseURL: applicationUrl });
    const page = await context.newPage();
    await installRuntime(page);
    await installStorage(page, { session });

    await openApplicationPage(page, '/cuenta.html');
    await expect(page.locator('#cloudAuthenticatedPanel')).toBeVisible();
    await expect(page.locator('#changePasswordLink')).toBeHidden();
    await assertNoHorizontalOverflow(page);

    await openApplicationPage(page, '/restablecer-clave.html?mode=change');
    await expect(page).toHaveURL(`${applicationUrl}/cuenta.html`);
    await expect(page.locator('#cloudAuthenticatedPanel')).toBeVisible();
    await expect(page.locator('#changePasswordLink')).toBeHidden();
    await context.close();
  }
});
