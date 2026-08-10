import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const runtimePath = process.env.PLAYWRIGHT_TEST_PATH;
if (!runtimePath) throw new Error('PLAYWRIGHT_TEST_PATH is required. Run Playwright through pnpm test:e2e.');
const require = createRequire(import.meta.url);
const { devices, expect, test } = require(runtimePath);
const visualCapture = process.env.PR_VISUAL_CAPTURE === '1';
const previewDirectory = resolve('.tmp/pr-previews');
const applicationUrl = 'http://127.0.0.1:3000';
const token = 'a'.repeat(64);
mkdirSync(previewDirectory, { recursive: true });

function requestBody(route) {
  try {
    return route.request().postDataJSON() || {};
  } catch {
    return {};
  }
}

function overviewFixture() {
  return {
    scope: 'account',
    rangeDays: 7,
    truncated: false,
    summary: {
      attempts: 14,
      verifiedAttempts: 8,
      watchAttempts: 3,
      excludedAttempts: 3,
      distinctAccounts: 3,
      distinctNicks: 5,
      distinctIps: 4,
      activeManualBans: 1,
    },
    entities: [
      {
        key: '11111111-1111-4111-8111-111111111111', label: '11111111-1111-4111-8111-111111111111',
        attempts: 8, verifiedAttempts: 3, watchAttempts: 2, excludedAttempts: 3,
        maxRiskScore: 91, averageRiskScore: 66, distinctNicks: 3, distinctAccounts: 1,
        distinctIps: 2, distinctDevices: 2, lastSeenAt: '2026-08-10T09:58:00Z',
      },
      {
        key: '22222222-2222-4222-8222-222222222222', label: '22222222-2222-4222-8222-222222222222',
        attempts: 6, verifiedAttempts: 5, watchAttempts: 1, excludedAttempts: 0,
        maxRiskScore: 35, averageRiskScore: 14, distinctNicks: 2, distinctAccounts: 1,
        distinctIps: 2, distinctDevices: 2, lastSeenAt: '2026-08-10T09:40:00Z',
      },
    ],
  };
}

function detailFixture() {
  const target = '11111111-1111-4111-8111-111111111111';
  return {
    scope: 'account',
    target,
    summary: {
      attempts: 8, verifiedAttempts: 3, watchAttempts: 2, excludedAttempts: 3,
      maxRiskScore: 91, distinctAccounts: 1, distinctNicks: 3, distinctIps: 2, distinctDevices: 2,
    },
    distribution: { '0-19': 1, '20-39': 1, '40-59': 1, '60-79': 2, '80-100': 3 },
    correlations: {
      accounts: [target],
      nicks: ['alpha', 'beta', 'gamma'],
      ips: ['1'.repeat(64), '2'.repeat(64)],
      devices: ['3'.repeat(64), '4'.repeat(64)],
    },
    attempts: [
      {
        id: 'attempt-1', nick: 'Alpha', nick_key: 'alpha', account_id: target,
        device_hash: '3'.repeat(64), ip_hash: '1'.repeat(64), difference_ms: 0,
        verified: false, verification_reasons: ['automation_signal'], created_at: '2026-08-10T09:58:00Z',
        integrity_status: 'excluded', risk_score: 91, risk_reasons: ['corroborated_automation'],
        integrity_evidence: { sessionAttempts2h: 7, sessionFingerprintMatches2h: 4 },
        integrity_policy_version: 3, integrity_evaluated_at: '2026-08-10T09:58:01Z',
      },
      {
        id: 'attempt-2', nick: 'Beta', nick_key: 'beta', account_id: target,
        device_hash: '4'.repeat(64), ip_hash: '2'.repeat(64), difference_ms: 22,
        verified: true, verification_reasons: [], created_at: '2026-08-10T09:40:00Z',
        integrity_status: 'watch', risk_score: 62, risk_reasons: ['shared_identity_cluster'],
        integrity_evidence: { sessionAttempts2h: 5 }, integrity_policy_version: 3,
        integrity_evaluated_at: '2026-08-10T09:40:01Z',
      },
    ],
    bans: [],
  };
}

async function installAdminMocks(page, { failLogins = 0 } = {}) {
  let loginAttempts = 0;
  const authorizedRequests = [];
  await page.route('**/functions/v1/zadmin-api', async (route) => {
    const body = requestBody(route);
    const headers = route.request().headers();
    if (body.action !== 'login') authorizedRequests.push(headers.authorization || '');

    if (body.action === 'login') {
      loginAttempts += 1;
      if (loginAttempts <= failLogins) {
        const blocked = loginAttempts >= 3;
        await route.fulfill({
          status: blocked ? 429 : 401,
          contentType: 'application/json',
          body: JSON.stringify(blocked
            ? { error: 'Demasiados intentos. Inténtalo más tarde.', code: 'login_rate_limited', attemptsRemaining: 0, retryAfterSeconds: 3600 }
            : { error: 'Credenciales no válidas.', code: 'invalid_credentials', attemptsRemaining: 3 - loginAttempts }),
        });
        return;
      }
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ token, expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() }),
      });
      return;
    }
    if (body.action === 'overview') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(overviewFixture()) });
      return;
    }
    if (body.action === 'detail') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detailFixture()) });
      return;
    }
    if (body.action === 'bans') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ bans: [] }) });
      return;
    }
    if (body.action === 'audit') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ events: [] }) });
      return;
    }
    if (body.action === 'ban') {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ banId: '33333333-3333-4333-8333-333333333333', scope: body.scope, target: body.target }),
      });
      return;
    }
    if (body.action === 'logout') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ loggedOut: true }) });
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Unknown action' }) });
  });
  return { authorizedRequests };
}

async function login(page) {
  await page.locator('#adminUsername').fill('operator');
  await page.locator('#adminPassword').fill('strong-test-password');
  await page.locator('#adminLoginButton').click();
  await expect(page.locator('#adminDashboard')).toBeVisible();
  await expect(page.locator('#adminEntityRows tr')).toHaveCount(2);
}

function evidenceDevice(isMobile) {
  return isMobile ? 'mobile' : 'desktop';
}

function evidenceContextOptions(isMobile, { recordVideo = false } = {}) {
  const device = isMobile
    ? devices['Pixel 5']
    : { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } };
  const videoSize = isMobile ? { ...device.viewport } : { width: 1280, height: 800 };
  return {
    ...device,
    baseURL: applicationUrl,
    ...(recordVideo ? { recordVideo: { dir: join(previewDirectory, 'recordings'), size: videoSize } } : {}),
  };
}

async function saveVideo(context, page, isMobile) {
  const video = page.video();
  if (!video) throw new Error('Playwright did not create the zadmin dashboard recording.');
  await context.close();
  await video.saveAs(join(previewDirectory, `zadmin-dashboard-${evidenceDevice(isMobile)}.webm`));
}

test('login exposes generic failures, blocks the third attempt and preserves the form', async ({ page }) => {
  await installAdminMocks(page, { failLogins: 3 });
  await page.goto('/zadmin/');
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.locator('#adminUsername').fill('operator');
    await page.locator('#adminPassword').fill(`wrong-${attempt}`);
    await page.locator('#adminLoginButton').click();
    if (attempt < 3) await expect(page.locator('#adminLoginStatus')).toContainText('Credenciales no válidas.');
  }
  await expect(page.locator('#adminLoginStatus')).toContainText('Demasiados intentos');
  await expect(page.locator('#adminLoginPanel')).toBeVisible();
  await expect(page.locator('#adminDashboard')).toBeHidden();
  await expect(page.locator('#adminUsername')).toHaveValue('operator');
});

test('authenticated investigation keeps the bearer token memory-only and exposes evidence without fabricating probability', async ({ page }) => {
  const mocks = await installAdminMocks(page);
  await page.goto('/zadmin/');
  await page.locator('#adminUsername').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('#adminPassword')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('.password-visibility-toggle')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#adminLoginButton')).toBeFocused();
  await page.locator('#adminUsername').fill('operator');
  await page.locator('#adminPassword').fill('strong-test-password');
  await page.keyboard.press('Enter');

  await expect(page.locator('#adminDashboard')).toBeVisible();
  await expect(page.locator('#adminOverviewStatus')).toContainText('14 intentos analizados');
  await expect(page.locator('#adminSummary')).toContainText('Bans manuales activos');
  expect(mocks.authorizedRequests.every((value) => value === `Bearer ${token}`)).toBe(true);

  const storage = await page.evaluate(() => ({
    local: Object.fromEntries(Object.entries(localStorage)),
    session: Object.fromEntries(Object.entries(sessionStorage)),
  }));
  expect(JSON.stringify(storage)).not.toContain(token);
  expect(Object.keys(storage.local)).toContain('minuto106.zadmin.device.v1');
  expect(storage.session).toEqual({});

  await page.locator('#adminEntityRows .zadmin-review-button').first().click();
  await expect(page.locator('#adminDetailContent')).toBeVisible();
  await expect(page.locator('#adminRiskBadge')).toHaveText('91/100');
  await expect(page.locator('#adminRiskDistribution')).toContainText('80-100');
  await expect(page.locator('#adminDetailContent')).toContainText('No es una probabilidad estadística de trampa.');
  await expect(page.locator('#adminAttemptList .zadmin-attempt')).toHaveCount(2);
  await page.locator('#adminAttemptList details summary').first().focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#adminAttemptList details').first()).toHaveAttribute('open', '');
});

test('manual ban requires evidence text and uses the inline confirmation component', async ({ page }) => {
  const payloads = [];
  await installAdminMocks(page);
  await page.route('**/functions/v1/zadmin-api', async (route) => {
    const body = requestBody(route);
    if (body.action === 'ban') {
      payloads.push(body);
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ banId: '33333333-3333-4333-8333-333333333333' }) });
      return;
    }
    await route.fallback();
  });
  await page.goto('/zadmin/');
  await login(page);
  await page.locator('#adminEntityRows .zadmin-review-button').first().click();
  await page.locator('#adminBanButton').click();
  await expect(page.locator('#adminBanStatus')).toContainText('al menos 3 caracteres');

  await page.locator('#adminBanDuration').selectOption('10080');
  await page.locator('#adminBanReason').fill('Correlación manual confirmada con evidencia de integridad.');
  await page.locator('#adminBanButton').click();
  await expect(page.locator('#adminBanConfirmComponent')).toBeVisible();
  await expect(page.locator('#adminBanConfirmMessage')).toContainText('Correlación manual confirmada');
  await expect(page.locator('#adminBanConfirmCancel')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#adminBanConfirmComponent')).toBeHidden();
  await expect(page.locator('#adminBanButton')).toBeFocused();
  expect(payloads).toHaveLength(0);

  await page.locator('#adminBanButton').click();
  await expect(page.locator('#adminBanConfirmComponent')).toBeVisible();
  await page.locator('#adminBanConfirmAccept').click();
  await expect(page.locator('#adminBanStatus')).toContainText('Ban aplicado');
  expect(payloads).toHaveLength(1);
  expect(payloads[0]).toMatchObject({
    action: 'ban',
    scope: 'account',
    target: '11111111-1111-4111-8111-111111111111',
    duration: 10080,
  });
});

test('zadmin remains operable without global overflow at 320px', async ({ page }) => {
  await installAdminMocks(page);
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto('/zadmin/');
  await login(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await expect(page.locator('#adminLogoutButton')).toHaveCSS('min-height', '44px');
  await expect(page.locator('#adminRefreshButton')).toHaveCSS('min-height', '44px');
  await expect(page.locator('.zadmin-table-scroll')).toHaveCSS('overflow-x', 'auto');
});

test('records isolated login and dashboard evidence from the admin workflow', async ({ browser, isMobile }) => {
  test.skip(!visualCapture, 'Visual evidence is generated only by the PR evidence workflow.');
  const suffix = evidenceDevice(isMobile);

  const screenshotContext = await browser.newContext(evidenceContextOptions(isMobile));
  const screenshotPage = await screenshotContext.newPage();
  await installAdminMocks(screenshotPage);
  await screenshotPage.goto('/zadmin/');
  await screenshotPage.screenshot({ path: join(previewDirectory, `zadmin-login-${suffix}.png`), animations: 'disabled', fullPage: true });
  await login(screenshotPage);
  await screenshotPage.locator('#adminEntityRows .zadmin-review-button').first().click();
  await expect(screenshotPage.locator('#adminDetailContent')).toBeVisible();
  await screenshotPage.screenshot({ path: join(previewDirectory, `zadmin-dashboard-${suffix}.png`), animations: 'disabled', fullPage: true });
  await screenshotContext.close();

  const recordingContext = await browser.newContext(evidenceContextOptions(isMobile, { recordVideo: true }));
  const recordingPage = await recordingContext.newPage();
  await installAdminMocks(recordingPage);
  await recordingPage.goto('/zadmin/');
  await login(recordingPage);
  await recordingPage.locator('#adminEntityRows .zadmin-review-button').first().click();
  await expect(recordingPage.locator('#adminDetailContent')).toBeVisible();
  await recordingPage.locator('#adminAttemptList details summary').first().click();
  await expect(recordingPage.locator('#adminAttemptList details').first()).toHaveAttribute('open', '');
  await recordingPage.locator('[data-admin-view="bans"]').click();
  await expect(recordingPage.locator('#adminBansView')).toBeVisible();
  await recordingPage.locator('[data-admin-view="audit"]').click();
  await expect(recordingPage.locator('#adminAuditView')).toBeVisible();
  await recordingPage.locator('[data-admin-view="investigation"]').click();
  await expect(recordingPage.locator('#adminInvestigationView')).toBeVisible();
  expect(await recordingPage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await saveVideo(recordingContext, recordingPage, isMobile);
});