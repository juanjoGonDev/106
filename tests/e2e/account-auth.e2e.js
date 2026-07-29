import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { openApplicationPage } from './app-navigation.js';

const runtimePath = process.env.PLAYWRIGHT_TEST_PATH;
if (!runtimePath) throw new Error('PLAYWRIGHT_TEST_PATH is required. Run Playwright through pnpm test:e2e.');
const require = createRequire(import.meta.url);
const { devices, expect, test } = require(runtimePath);

const previewDirectory = '.tmp/pr-previews';
const captureEvidence = process.env.PR_VISUAL_CAPTURE === '1';
const applicationUrl = 'http://127.0.0.1:3000';
const publishableKey = `sb_publishable_${'a'.repeat(32)}`;
const accountToken = 'b'.repeat(64);
const storedConsent = JSON.stringify({ analytics: false, ads: false, updatedAt: '2026-07-27T00:00:00.000Z' });
mkdirSync(previewDirectory, { recursive: true });

function session({ provider = 'email', providers = [provider], confirmed = true } = {}) {
  return {
    access_token: 'access-token',
    refresh_token: 'refresh-token',
    expires_at: 2_000_000_000,
    token_type: 'bearer',
    user: {
      id: '11111111-1111-4111-8111-111111111111',
      email: 'player@example.com',
      email_confirmed_at: confirmed ? '2026-07-27T00:00:00.000Z' : null,
      app_metadata: { provider, providers },
      identities: providers.map((value) => ({ provider: value })),
    },
  };
}

function mergeImpact() {
  return {
    leagues: [{ name: 'Liga de amigos', publicId: 'FRI106' }],
    trophies: [{ title: 'Campeón de liga', nick: 'CronoMaster' }],
    achievements: [{ title: 'Podio de liga', nick: 'CronoMaster' }],
    duels: [{ challenger: 'CronoMaster', opponent: 'Rival106' }],
    referrals: [{ referrer: 'Rival106', referred: 'CronoMaster' }],
    bonusAdjustments: [{ nick: 'Rival106', attempts: 1 }],
    totalLosses: 6,
  };
}

function bodyOf(request) {
  try {
    return request.postDataJSON() || {};
  } catch {
    return {};
  }
}

async function installRuntimeConfig(page) {
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
}

async function installGameApi(page) {
  await page.route('**/functions/v1/player-context', async (route) => {
    const body = bodyOf(route.request());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        availability: body.nick === 'Nuevo106' ? 'available' : 'unknown',
        profile: null,
        leagues: [],
      }),
    });
  });
  await page.route('**/functions/v1/game-api', async (route) => {
    const body = bodyOf(route.request());
    if (body.action === 'account-players') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          exists: true,
          players: [
            { nick: 'CronoMaster', team: 'spain', attemptsLeft: 2, bestDifferenceMs: 14 },
            { nick: 'Rival106', team: 'argentina', attemptsLeft: 0, bestDifferenceMs: 42 },
          ],
        }),
      });
      return;
    }
    if (body.action === 'link-account-player') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ authorized: true, created: true }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

async function installAuthApi(page, log = []) {
  await page.route('**/auth/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const body = bodyOf(request);
    log.push({ path: url.pathname, search: url.search, method: request.method(), body });

    if (url.pathname.endsWith('/token') && url.searchParams.get('grant_type') === 'password') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(session()) });
      return;
    }
    if (url.pathname.endsWith('/signup')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: { id: 'pending-user' } }) });
      return;
    }
    if (url.pathname.endsWith('/verify')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(session()) });
      return;
    }
    if (url.pathname.endsWith('/resend') || url.pathname.endsWith('/recover')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      return;
    }
    if (url.pathname.endsWith('/user') && request.method() === 'PUT') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(session().user) });
      return;
    }
    if (url.pathname.endsWith('/logout')) {
      await route.fulfill({ status: 204, contentType: 'application/json', body: '' });
      return;
    }
    if (url.pathname.endsWith('/authorize')) {
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<title>OAuth provider</title>' });
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Unexpected auth request' }) });
  });
}

async function installAccountAuthApi(page, mode = 'linked', log = []) {
  await page.route('**/functions/v1/account-auth', async (route) => {
    const body = bodyOf(route.request());
    log.push(body);
    if (body.action === 'sync-account' && mode === 'merge') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          mergeRequired: true,
          proposalId: '22222222-2222-4222-8222-222222222222',
          fingerprint: 'c'.repeat(64),
          impact: mergeImpact(),
        }),
      });
      return;
    }
    if (body.action === 'confirm-merge') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ merged: true, impact: mergeImpact(), authReward: { active: true, source: 'email_confirmation' } }),
      });
      return;
    }
    if (body.action === 'cancel-merge') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ cancelled: true }) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        linked: true,
        accountToken,
        authReward: { active: true, source: 'email_confirmation', dailyAttemptBonus: 1 },
      }),
    });
  });
}

async function installPage(page, { mode = 'linked', authLog = [], accountLog = [], initial = {} } = {}) {
  await installRuntimeConfig(page);
  await installGameApi(page);
  await installAuthApi(page, authLog);
  await installAccountAuthApi(page, mode, accountLog);
  await page.addInitScript(({ consent, token, storedSession, pendingEmail }) => {
    localStorage.setItem('minuto106:consent-v1', consent);
    if (token) localStorage.setItem('minuto106:account-access-v1', token);
    if (storedSession) localStorage.setItem('minuto106:supabase-session-v1', JSON.stringify(storedSession));
    if (pendingEmail) localStorage.setItem('minuto106:pending-email-confirmation-v1', pendingEmail);
  }, {
    consent: storedConsent,
    token: initial.accountToken || '',
    storedSession: initial.session || null,
    pendingEmail: initial.pendingEmail || '',
  });
}

function evidenceName(area, isMobile) {
  return `${area}-${isMobile ? 'mobile' : 'desktop'}`;
}

function recordingContextOptions(isMobile, initial = {}) {
  const device = isMobile
    ? devices['Pixel 5']
    : { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } };
  const localStorage = [{ name: 'minuto106:consent-v1', value: storedConsent }];
  if (initial.accountToken) localStorage.push({ name: 'minuto106:account-access-v1', value: initial.accountToken });
  if (initial.session) localStorage.push({ name: 'minuto106:supabase-session-v1', value: JSON.stringify(initial.session) });
  if (initial.pendingEmail) localStorage.push({ name: 'minuto106:pending-email-confirmation-v1', value: initial.pendingEmail });
  return {
    ...device,
    baseURL: applicationUrl,
    recordVideo: {
      dir: join(previewDirectory, 'recordings'),
      size: isMobile ? { ...device.viewport } : { width: 1280, height: 800 },
    },
    storageState: { cookies: [], origins: [{ origin: applicationUrl, localStorage }] },
  };
}

async function saveScreenshot(page, area, isMobile) {
  if (!captureEvidence) return;
  await page.screenshot({
    path: join(previewDirectory, `${evidenceName(area, isMobile)}.png`),
    animations: 'disabled',
    fullPage: true,
  });
}

async function saveVideo(context, page, area, isMobile) {
  if (!captureEvidence) {
    await context.close();
    return;
  }
  const video = page.video();
  if (!video) throw new Error(`Playwright did not create the ${area} recording.`);
  await context.close();
  await video.saveAs(join(previewDirectory, `${evidenceName(area, isMobile)}.webm`));
}

async function assertNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test('login, registration and local linking expose only Google with contextual labels', async ({ browser }) => {
  for (const [path, label, initial] of [
    ['login.html', 'Continuar con Google', {}],
    ['registro.html', 'Crear con Google', {}],
    ['cuenta.html', 'Vincular Google', { accountToken }],
  ]) {
    const context = await browser.newContext({ baseURL: applicationUrl });
    const page = await context.newPage();
    await installPage(page, { initial });
    await openApplicationPage(page, `/${path}`);
    await expect(page.locator('.oauth-button:visible')).toHaveCount(1);
    await page.getByRole('button', { name: label }).click();
    await expect(page).toHaveURL(/\/auth\/v1\/authorize[?].*provider=google/u);
    expect(new URL(page.url()).searchParams.get('redirect_to')).toBe(`${applicationUrl}/cuenta.html`);
    expect(new URL(page.url()).searchParams.get('code_challenge_method')).toBe('s256');
    await context.close();
  }
});

test('email registration uses progressive validation, dedicated verification and neutral recovery', async ({ page }) => {
  const authLog = [];
  await installPage(page, { authLog });
  await openApplicationPage(page, '/registro.html');

  const signup = page.locator('#authSubmit');
  await expect(signup).toBeDisabled();
  await page.locator('#authEmail').fill('Player@Example.com');
  await page.locator('#authPassword').fill('short');
  await expect(page.locator('[data-requirement="length"]')).toHaveAttribute('data-met', 'false');
  await page.locator('#authPassword').fill('Secure123!');
  await page.locator('#authPasswordConfirmation').fill('Different1!');
  await expect(page.locator('#authPasswordMatch')).toHaveText('Las contraseñas no coinciden.');
  await page.locator('#authPasswordConfirmation').fill('Secure123!');
  await expect(signup).toBeEnabled();
  await signup.click();

  await expect(page).toHaveURL(/\/verificar-email\.html$/u);
  await expect(page.locator('.verification-prize')).toContainText('+1 intento diario');
  await expect(page.locator('#pendingConfirmationEmail')).toContainText('player@example.com');
  expect(authLog.some((entry) => entry.path.endsWith('/signup'))).toBe(true);

  await openApplicationPage(page, '/login.html');
  await page.locator('#authEmail').fill('Player@Example.com');
  await page.locator('#authRecovery').click();
  await expect(page.locator('#authStatus')).toHaveText('Si existe una cuenta asociada, recibirás un correo con los siguientes pasos.');
  expect(authLog.some((entry) => entry.path.endsWith('/recover'))).toBe(true);
});

test('verification accepts a numeric code, synchronizes once and hides resend controls', async ({ page }) => {
  const authLog = [];
  await installPage(page, {
    authLog,
    initial: { accountToken, pendingEmail: 'player@example.com' },
  });
  await openApplicationPage(page, '/verificar-email.html');
  await page.locator('#authOtp').fill('12a34-56');
  await expect(page.locator('#authOtp')).toHaveValue('123456');
  await expect(page.locator('#verifyEmailCode')).toBeEnabled();
  await page.locator('#verifyEmailCode').click();
  await expect(page.locator('#verificationSuccess')).toBeVisible();
  await expect(page.locator('#verificationSuccessMessage')).toContainText('+1 intento diario');
  await expect(page.locator('#verifyEmailCode')).toBeHidden();
  await expect(page.locator('#emailConfirmationResend')).toBeHidden();
  expect(authLog.some((entry) => entry.path.endsWith('/verify') && entry.body.type === 'email')).toBe(true);
});

test('authenticated and local accounts cannot revisit login or registration', async ({ browser }) => {
  for (const [path, initial] of [
    ['login.html', { session: session() }],
    ['registro.html', { accountToken }],
  ]) {
    const context = await browser.newContext({ baseURL: applicationUrl });
    const page = await context.newPage();
    await installPage(page, { initial });
    await openApplicationPage(page, `/${path}`);
    await expect(page).toHaveURL(/\/cuenta\.html$/u);
    await context.close();
  }
});

test('records the contextual authenticated account on desktop and mobile', async ({ browser, isMobile }) => {
  const context = await browser.newContext(recordingContextOptions(isMobile, {
    accountToken,
    session: session({ provider: 'google', providers: ['google'] }),
  }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await installPage(page);
  await openApplicationPage(page, '/cuenta.html');

  await expect(page.locator('#cloudAuthenticatedPanel')).toBeVisible();
  await expect(page.locator('#cloudAccountIdentity')).toContainText('player@example.com');
  await expect(page.getByRole('button', { name: 'Google vinculado' })).toBeDisabled();
  await expect(page.locator('#cloudAuthenticatedPanel .oauth-button')).toHaveCount(1);
  await expect(page.locator('#emailConfirmationPanel')).toHaveCount(0);
  await expect(page.locator('#accountPlayers')).toContainText('CronoMaster');
  await assertNoHorizontalOverflow(page);
  await saveScreenshot(page, 'account-auth', isMobile);
  expect(errors).toEqual([]);
  await saveVideo(context, page, 'account-auth', isMobile);
});

test('records exact competitive losses and requires explicit merge confirmation', async ({ browser, isMobile }) => {
  const context = await browser.newContext(recordingContextOptions(isMobile, {
    accountToken,
    session: session(),
  }));
  const page = await context.newPage();
  const accountLog = [];
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await installPage(page, { mode: 'merge', accountLog });
  await openApplicationPage(page, '/cuenta.html');

  const dialog = page.locator('#accountMergeDialog');
  await expect(dialog).toBeVisible();
  await expect(page.locator('#confirmAccountMerge')).toBeFocused();
  await expect(dialog).toContainText('6 consecuencias competitivas');
  await expect(dialog).toContainText('Liga de amigos · FRI106');
  await expect(dialog).toContainText('CronoMaster contra Rival106');
  await assertNoHorizontalOverflow(page);
  await saveScreenshot(page, 'account-merge-impact', isMobile);

  await page.locator('#confirmAccountMerge').click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('#cloudAccountStatus')).toContainText('Se aplicaron 6 correcciones competitivas');
  expect(accountLog.some((entry) => entry.action === 'confirm-merge')).toBe(true);
  expect(errors).toEqual([]);
  await saveVideo(context, page, 'account-merge-impact', isMobile);
});

test('canceling a merge sends cancellation and performs no confirmation', async ({ page }) => {
  const accountLog = [];
  await installPage(page, {
    mode: 'merge',
    accountLog,
    initial: { accountToken, session: session() },
  });
  await openApplicationPage(page, '/cuenta.html');
  await expect(page.locator('#accountMergeDialog')).toBeVisible();
  await page.locator('#cancelAccountMerge').click();
  await expect(page.locator('#accountMergeDialog')).toBeHidden();
  await expect.poll(() => accountLog.some((entry) => entry.action === 'cancel-merge')).toBe(true);
  expect(accountLog.some((entry) => entry.action === 'confirm-merge')).toBe(false);
});

test('password reset validates progressive requirements and exact confirmation responsively', async ({ page, isMobile }) => {
  const authLog = [];
  await installRuntimeConfig(page);
  await installAuthApi(page, authLog);
  await page.addInitScript(({ storedSession }) => {
    localStorage.setItem('minuto106:supabase-session-v1', JSON.stringify(storedSession));
  }, { storedSession: session() });
  await openApplicationPage(page, '/restablecer-clave.html');

  await page.locator('#newPassword').fill('NewSecure1!');
  await expect(page.locator('#passwordResetRequirements li[data-met="true"]')).toHaveCount(5);
  await page.locator('#confirmNewPassword').fill('Different1!');
  await expect(page.locator('#updatePassword')).toBeDisabled();
  await page.locator('#confirmNewPassword').fill('NewSecure1!');
  await expect(page.locator('#updatePassword')).toBeEnabled();
  await saveScreenshot(page, 'password-reset', isMobile);
  await page.locator('#updatePassword').click();
  await expect(page.locator('#passwordResetStatus')).toContainText('Contraseña actualizada');
  expect(authLog.some((entry) => entry.path.endsWith('/user') && entry.method === 'PUT')).toBe(true);
  await assertNoHorizontalOverflow(page);
});