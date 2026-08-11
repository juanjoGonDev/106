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
mkdirSync(previewDirectory, { recursive: true });

function contextPayload(restriction) {
  return {
    availability: 'available',
    profile: null,
    leagues: [],
    dailyAttemptPolicy: {
      baseAttempts: 6,
      bonusAttempts: 0,
      totalAttempts: 6,
      usedAttempts: 0,
      attemptsLeft: 6,
    },
    restriction,
  };
}

async function installRestrictionContext(page, restrictionFactory) {
  const contextRequests = [];
  const readyRequests = [];
  await page.route('**/functions/v1/player-context', async (route) => {
    const body = route.request().postDataJSON?.() ?? {};
    contextRequests.push(body.action);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(contextPayload(restrictionFactory())),
    });
  });
  await page.route('**/functions/v1/game-ready-api', async (route) => {
    readyRequests.push(route.request().postDataJSON?.() ?? {});
    await route.abort();
  });
  return { contextRequests, readyRequests };
}

function timedAutomaticRestriction(expiresAt) {
  return {
    active: true,
    source: 'integrity',
    scope: 'device',
    permanent: false,
    expiresAt: new Date(expiresAt).toISOString(),
    retryAfterSeconds: Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000)),
  };
}

function evidenceContextOptions(isMobile) {
  const device = isMobile
    ? devices['Pixel 5']
    : { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } };
  const videoSize = isMobile ? { ...device.viewport } : { width: 1280, height: 800 };
  return {
    ...device,
    baseURL: applicationUrl,
    recordVideo: { dir: join(previewDirectory, 'recordings'), size: videoSize },
  };
}

async function saveRestrictionVideo(context, page, isMobile) {
  const video = page.video();
  if (!video) throw new Error('Playwright did not create the play restriction recording.');
  await context.close();
  await video.saveAs(join(previewDirectory, `play-restriction-${isMobile ? 'mobile' : 'desktop'}.webm`));
}

test('timed automatic restriction blocks Comenzar before verification and refreshes at expiry', async ({ page, isMobile }) => {
  const expiresAt = Date.now() + 2_500;
  const requests = await installRestrictionContext(page, () => Date.now() < expiresAt
    ? timedAutomaticRestriction(expiresAt)
    : null);

  await page.goto('/');
  await page.locator('#nick').fill(`Blocked${Date.now().toString(36)}`.slice(0, 20));
  await page.locator('.team-picker [data-team="spain"]').click();

  const restriction = page.locator('#playRestriction');
  await expect(restriction).toBeVisible();
  await expect(page.locator('#playRestrictionTitle')).toHaveText('Acceso competitivo bloqueado');
  await expect(page.locator('#playRestrictionSource')).toContainText('Integridad automática');
  await expect(page.locator('#playRestrictionSource')).toContainText('dispositivo');
  await expect(page.locator('#playRestrictionReason')).toContainText('controles de integridad');
  await expect(page.locator('#playRestrictionCountdown')).toHaveText(/^00:00:0[1-3]$/);
  await expect(page.locator('#startButton')).toBeDisabled();
  await expect(page.locator('#startButton')).toHaveText('Acceso bloqueado');
  expect(requests.readyRequests).toHaveLength(0);

  if (visualCapture) {
    await page.screenshot({
      path: join(previewDirectory, `play-restriction-${isMobile ? 'mobile' : 'desktop'}.png`),
      animations: 'disabled',
      fullPage: true,
    });
  }

  await expect(restriction).toBeHidden({ timeout: 7_000 });
  await expect(page.locator('#startButton')).toBeEnabled({ timeout: 7_000 });
  expect(requests.contextRequests.filter((action) => action === 'player-context').length).toBeGreaterThanOrEqual(2);
  expect(requests.readyRequests).toHaveLength(0);
});

test('expired restriction stays fail-closed when server confirmation fails', async ({ page }) => {
  const expiresAt = Date.now() + 2_000;
  const readyRequests = [];
  let failedRefreshes = 0;
  await page.route('**/functions/v1/player-context', async (route) => {
    if (Date.now() >= expiresAt) {
      failedRefreshes += 1;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Servidor temporalmente no disponible.' }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(contextPayload(timedAutomaticRestriction(expiresAt))),
    });
  });
  await page.route('**/functions/v1/game-ready-api', async (route) => {
    readyRequests.push(route.request().postDataJSON?.() ?? {});
    await route.abort();
  });

  await page.goto('/');
  await page.locator('#nick').fill(`FailClosed${Date.now().toString(36)}`.slice(0, 20));
  await page.locator('.team-picker [data-team="spain"]').click();
  await expect(page.locator('#playRestriction')).toBeVisible();
  await expect(page.locator('#startButton')).toBeDisabled();

  await expect(page.locator('#playRestrictionSource')).toHaveText('Comprobación pendiente', { timeout: 7_000 });
  await expect(page.locator('#playRestrictionReason')).toContainText('seguirá bloqueado');
  await expect(page.locator('#nickStatus')).toContainText('sigue bloqueado');
  await expect(page.locator('#startButton')).toBeDisabled();
  await expect(page.locator('#startButton')).toHaveText('Acceso bloqueado');
  expect(failedRefreshes).toBeGreaterThanOrEqual(1);
  expect(readyRequests).toHaveLength(0);
});

test('permanent manual restriction uses a stable inline component at 320px', async ({ page }) => {
  await installRestrictionContext(page, () => ({
    active: true,
    source: 'manual',
    scope: 'nick',
    permanent: true,
    expiresAt: null,
    retryAfterSeconds: null,
  }));
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto('/');
  await page.locator('#nick').fill(`Manual${Date.now().toString(36)}`.slice(0, 20));
  await page.locator('.team-picker [data-team="argentina"]').click();

  await expect(page.locator('#playRestriction')).toBeVisible();
  await expect(page.locator('#playRestrictionSource')).toContainText('Administración');
  await expect(page.locator('#playRestrictionSource')).toContainText('nick');
  await expect(page.locator('#playRestrictionReason')).toContainText('restricción manual');
  await expect(page.locator('#playRestrictionCountdown')).toHaveText('Permanente');
  await expect(page.locator('#playRestrictionEnd')).toHaveText('Sin fecha de finalización.');
  await expect(page.locator('#startButton')).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test('records the live restriction countdown for platform evidence', async ({ browser, isMobile }) => {
  test.skip(!visualCapture, 'Interaction evidence is generated only by the PR evidence workflow.');
  const context = await browser.newContext(evidenceContextOptions(isMobile));
  const page = await context.newPage();
  const expiresAt = Date.now() + 5_000;
  await installRestrictionContext(page, () => timedAutomaticRestriction(expiresAt));

  await page.goto('/');
  await page.locator('#nick').fill(`Evidence${Date.now().toString(36)}`.slice(0, 20));
  await page.locator('.team-picker [data-team="spain"]').click();
  const restriction = page.locator('#playRestriction');
  const countdown = page.locator('#playRestrictionCountdown');
  await expect(restriction).toBeVisible();
  await expect(countdown).toBeVisible();
  await countdown.scrollIntoViewIfNeeded();
  await expect(countdown).toBeInViewport();
  await expect(page.locator('#startButton')).toBeDisabled();
  const initial = await countdown.textContent();
  await expect(countdown).not.toHaveText(initial || '', { timeout: 3_000 });
  await expect(page.locator('#playRestrictionSource')).toContainText('Integridad automática');
  await saveRestrictionVideo(context, page, isMobile);
});