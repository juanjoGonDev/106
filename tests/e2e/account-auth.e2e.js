import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

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

function session(overrides = {}) {
  return {
    access_token: 'access-token',
    refresh_token: 'refresh-token',
    expires_at: 2_000_000_000,
    token_type: 'bearer',
    user: {
      id: '11111111-1111-4111-8111-111111111111',
      email: 'player@example.com',
      email_confirmed_at: '2026-07-27T00:00:00.000Z',
      app_metadata: { provider: 'email' },
    },
    ...overrides,
  };
}

function mergeImpact() {
  return {
    leagues: [{ name: 'Liga de amigos', publicId: 'FRI106' }],
    trophies: [{ title: 'Campeón de liga', nick: 'CronoMaster', leagueName: 'Liga de amigos' }],
    achievements: [
      { title: 'Podio de liga', nick: 'CronoMaster', kind: 'league_podium', points: 20 },
      { title: 'Primer fichaje', nick: 'Rival106', kind: 'referral_total', points: 15 },
    ],
    duels: [{ id: 'duel-1', challenger: 'CronoMaster', opponent: 'Rival106', winner: 'CronoMaster', rewardAttempts: 1 }],
    referrals: [{ id: 'referral-1', referrer: 'Rival106', referred: 'CronoMaster', rewardAttempts: 1 }],
    bonusAdjustments: [{ nick: 'CronoMaster', attempts: 1 }, { nick: 'Rival106', attempts: 1 }],
    totalLosses: 8,
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
  await page.route('**/config.js', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `window.__MINUTO106_CONFIG__ = ${JSON.stringify({
        apiBaseUrl: 'https://project.supabase.co/functions/v1/game-api',
        accountAuthApiUrl: 'https://project.supabase.co/functions/v1/account-auth',
        supabaseUrl: 'https://project.supabase.co',
        supabasePublishableKey: publishableKey,
        turnstileSiteKey: '',
        publicSiteUrl: 'http://127.0.0.1:3000',
      })};`,
    });
  });
}

async function installGameApi(page) {
  await page.route('**/functions/v1/game-api', async (route) => {
    const body = bodyOf(route.request());
    if (body.action === 'account-players') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          exists: true,
          players: [
            { nick: 'CronoMaster', team: 'spain', attemptsUsed: 3, verifiedAttempts: 3, attemptsLeft: 2, bestDifferenceMs: 14 },
            { nick: 'Rival106', team: 'argentina', attemptsUsed: 5, verifiedAttempts: 5, attemptsLeft: 0, bestDifferenceMs: 42 },
          ],
        }),
      });
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
    if (url.pathname.endsWith('/token') && url.searchParams.get('grant_type') === 'pkce') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(session()) });
      return;
    }
    if (url.pathname.endsWith('/recover')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      return;
    }
    if (url.pathname.endsWith('/signup')) {
      await route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ error_code: 'user_already_exists', msg: 'User already registered' }) });
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
          linked: false,
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
        body: JSON.stringify({ merged: true, impact: mergeImpact() }),
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
        issueToken: false,
        auth: { provider: 'email', email: 'player@example.com', emailVerified: true },
        verificationReward: { eligible: true, active: true, granted: false, dailyAttemptBonus: 1 },
      }),
    });
  });
}

async function installAccountPage(page, options = {}) {
  await installRuntimeConfig(page);
  await installGameApi(page);
  await installAuthApi(page, options.authLog);
  await installAccountAuthApi(page, options.mode, options.accountLog);
  await page.addInitScript(({ token }) => {
    localStorage.setItem('minuto106:account-access-v1', token);
  }, { token: accountToken });
}

function evidenceName(area, isMobile) {
  return `${area}-${isMobile ? 'mobile' : 'desktop'}`;
}

function recordingContextOptions(isMobile) {
  const device = isMobile
    ? devices['Pixel 5']
    : { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } };
  const videoSize = isMobile ? { ...device.viewport } : { width: 1280, height: 800 };
  return {
    ...device,
    baseURL: applicationUrl,
    recordVideo: { dir: join(previewDirectory, 'recordings'), size: videoSize },
    storageState: {
      cookies: [],
      origins: [{
        origin: applicationUrl,
        localStorage: [
          { name: 'minuto106:consent-v1', value: storedConsent },
          { name: 'minuto106:account-access-v1', value: accountToken },
        ],
      }],
    },
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

test('Google and Facebook buttons initiate only the configured PKCE providers', async ({ page }) => {
  await installAccountPage(page);
  await page.goto('/cuenta.html');

  await page.getByRole('button', { name: 'Continuar con Google' }).click();
  await expect(page).toHaveURL(/\/auth\/v1\/authorize\?.*provider=google/);
  expect(new URL(page.url()).searchParams.get('code_challenge_method')).toBe('s256');

  await page.goto('/cuenta.html');
  await page.getByRole('button', { name: 'Continuar con Facebook' }).click();
  await expect(page).toHaveURL(/\/auth\/v1\/authorize\?.*provider=facebook/);
  expect(new URL(page.url()).searchParams.get('redirect_to')).toBe('http://127.0.0.1:3000/cuenta.html');
});

test('email registration requires progressive password rules and exact confirmation', async ({ page }) => {
  const authLog = [];
  await installAccountPage(page, { authLog });
  await page.goto('/cuenta.html');

  const signup = page.locator('#emailSignUp');
  await expect(signup).toBeDisabled();
  await page.locator('#authEmail').fill('Existing@Example.com');
  await page.locator('#authPassword').fill('short');
  await expect(page.locator('[data-requirement="length"]')).toHaveAttribute('data-met', 'false');
  await expect(signup).toBeDisabled();

  await page.locator('#authPassword').fill('Secure123!');
  await expect(page.locator('#authPasswordRequirements li[data-met="true"]')).toHaveCount(5);
  await page.locator('#authPasswordConfirmation').fill('Different1!');
  await expect(page.locator('#authPasswordMatch')).toHaveText('Las contraseñas no coinciden.');
  await expect(signup).toBeDisabled();

  await page.locator('#authPasswordConfirmation').fill('Secure123!');
  await expect(page.locator('#authPasswordMatch')).toHaveText('Las contraseñas coinciden.');
  await expect(signup).toBeEnabled();
  await signup.click();
  await expect(page.locator('#cloudAccountStatus')).toContainText('enlace de un solo uso');
  await expect(page.locator('#cloudAccountStatus')).toContainText('+1 intento diario');

  await page.locator('#emailRecovery').click();
  await expect(page.locator('#cloudAccountStatus')).toHaveText('Si existe una cuenta asociada, recibirás un correo con los siguientes pasos.');
  expect(authLog.some((entry) => entry.path.endsWith('/signup'))).toBe(true);
  expect(authLog.some((entry) => entry.path.endsWith('/recover'))).toBe(true);
});

test('records the complete optional account login flow on desktop and mobile', async ({ browser, isMobile }) => {
  const context = await browser.newContext(recordingContextOptions(isMobile));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await installAccountPage(page, { mode: 'linked' });
  await page.goto('/cuenta.html');

  await expect(page.locator('#cloudAccountStatus')).toContainText('Vincula Google, Facebook o email');
  await expect(page.locator('#accountPlayers')).toContainText('CronoMaster');
  await assertNoHorizontalOverflow(page);
  await saveScreenshot(page, 'account-auth', isMobile);

  await page.locator('#authEmail').fill('player@example.com');
  await page.locator('#authPassword').fill('SecurePassword123!');
  await page.locator('#emailSignIn').click();
  await expect(page.locator('#cloudAccountIdentity')).toContainText('player@example.com · email');
  await expect(page.locator('#cloudAccountStatus')).toContainText('bonificación de +1 intento diario');
  expect(errors).toEqual([]);
  await saveVideo(context, page, 'account-auth', isMobile);
});

test('records exact competitive losses and requires explicit merge confirmation', async ({ browser, isMobile }) => {
  const context = await browser.newContext(recordingContextOptions(isMobile));
  const page = await context.newPage();
  const accountLog = [];
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await installAccountPage(page, { mode: 'merge', accountLog });
  await page.goto('/cuenta.html');
  await page.locator('#authEmail').fill('player@example.com');
  await page.locator('#authPassword').fill('SecurePassword123!');
  await page.locator('#emailSignIn').click();

  const dialog = page.locator('#accountMergeDialog');
  await expect(dialog).toBeVisible();
  await expect(page.locator('#confirmAccountMerge')).toBeFocused();
  await expect(dialog).toContainText('8 consecuencias competitivas');
  await expect(dialog).toContainText('Liga de amigos · FRI106');
  await expect(dialog).toContainText('Campeón de liga · CronoMaster');
  await expect(dialog).toContainText('CronoMaster contra Rival106');
  await expect(dialog).toContainText('Rival106 invitó a CronoMaster');
  await expect(dialog).toContainText('Rival106: −1 intentos extra');
  await assertNoHorizontalOverflow(page);
  await saveScreenshot(page, 'account-merge-impact', isMobile);

  await page.locator('#confirmAccountMerge').click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('#cloudAccountStatus')).toContainText('Se aplicaron 8 correcciones competitivas');
  expect(accountLog.some((entry) => entry.action === 'confirm-merge')).toBe(true);
  expect(errors).toEqual([]);
  await saveVideo(context, page, 'account-merge-impact', isMobile);
});

test('canceling a merge sends cancellation and performs no confirmation', async ({ page }) => {
  const accountLog = [];
  await installAccountPage(page, { mode: 'merge', accountLog });
  await page.goto('/cuenta.html');
  await page.locator('#authEmail').fill('player@example.com');
  await page.locator('#authPassword').fill('SecurePassword123!');
  await page.locator('#emailSignIn').click();
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
  await page.goto('/restablecer-clave.html');

  await page.locator('#newPassword').fill('NewSecure1!');
  await expect(page.locator('#passwordResetRequirements li[data-met="true"]')).toHaveCount(5);
  await page.locator('#confirmNewPassword').fill('Different1!');
  await expect(page.locator('#updatePassword')).toBeDisabled();
  await expect(page.locator('#passwordResetMatch')).toHaveText('Las contraseñas no coinciden.');
  await page.locator('#confirmNewPassword').fill('NewSecure1!');
  await expect(page.locator('#updatePassword')).toBeEnabled();
  await saveScreenshot(page, 'password-reset', isMobile);
  await page.locator('#updatePassword').click();
  await expect(page.locator('#passwordResetStatus')).toContainText('Contraseña actualizada');
  await expect(page.locator('#returnToAccount')).toBeVisible();
  expect(authLog.some((entry) => entry.path.endsWith('/user') && entry.method === 'PUT')).toBe(true);
  await assertNoHorizontalOverflow(page);
});
