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

function cloudSession() {
  return {
    access_token: 'access-token',
    refresh_token: 'refresh-token',
    expires_at: 2_000_000_000,
    token_type: 'bearer',
    user: {
      id: '11111111-1111-4111-8111-111111111111',
      email: 'player@example.com',
      email_confirmed_at: '2026-07-29T00:00:00.000Z',
      app_metadata: { provider: 'email', providers: ['email'] },
      identities: [{ provider: 'email' }],
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

async function installRuntime(page) {
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
    if (url.pathname.endsWith('/logout')) {
      await route.fulfill({ status: 204, body: '' });
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

async function installStorage(page, { session = null, pendingEmail = '', token = '' } = {}) {
  await page.addInitScript(({ consent, storedSession, email, accountKey }) => {
    localStorage.setItem('minuto106:consent-v1', consent);
    if (storedSession) localStorage.setItem('minuto106:supabase-session-v1', JSON.stringify(storedSession));
    if (email) {
      localStorage.setItem('minuto106:pending-email-confirmation-v1', email);
      localStorage.setItem('minuto106:email-resend-available-at-v1', '2000000000000');
    }
    if (accountKey) localStorage.setItem('minuto106:account-access-v1', accountKey);
  }, {
    consent: storedConsent,
    storedSession: session,
    email: pendingEmail,
    accountKey: token,
  });
}

async function assertNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test('cloud sign-out clears stale activation state and rerenders without reload', async ({ page }) => {
  const errors = [];
  const failedRequests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) failedRequests.push(`${response.status()} ${response.url()}`);
  });
  await installRuntime(page);
  await installStorage(page, {
    session: cloudSession(),
    pendingEmail: 'stale@example.com',
  });
  await openApplicationPage(page, '/cuenta.html');

  await expect(page.locator('#cloudAuthenticatedPanel')).toBeVisible();
  await expect(page.locator('#cloudAccountIdentity')).toContainText('player@example.com');
  await page.locator('#cloudSignOut').click();

  await expect(page.locator('#cloudAuthenticatedPanel')).toBeHidden();
  await expect(page.locator('#cloudPendingPanel')).toBeHidden();
  await expect(page.locator('#cloudLocalLinkPanel')).toBeVisible();
  await expect(page.locator('#cloudAccountStatus')).toContainText('Sesión en la nube cerrada');
  await expect(page.locator('#cloudAccountPanel')).not.toContainText('stale@example.com');
  await expect.poll(() => page.evaluate(() => ({
    pending: localStorage.getItem('minuto106:pending-email-confirmation-v1'),
    resend: localStorage.getItem('minuto106:email-resend-available-at-v1'),
  }))).toEqual({ pending: null, resend: null });
  await expect(page).toHaveURL(`${applicationUrl}/cuenta.html`);
  await assertNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
  expect(failedRequests).toEqual([]);
});

test('all password routes use one accessible eye control without changing values', async ({ browser }) => {
  for (const { path, inputs, session } of [
    { path: '/login.html', inputs: ['authPassword'], session: null },
    { path: '/registro.html', inputs: ['authPassword', 'authPasswordConfirmation'], session: null },
    { path: '/restablecer-clave.html', inputs: ['newPassword', 'confirmNewPassword'], session: cloudSession() },
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

test('direct password recovery access without a cloud session is guarded', async ({ page }) => {
  await installRuntime(page);
  await installStorage(page);
  await openApplicationPage(page, '/restablecer-clave.html');
  await expect(page).toHaveURL(`${applicationUrl}/login.html`);
  await expect(page.locator('#loginTitle')).toBeVisible();
});
