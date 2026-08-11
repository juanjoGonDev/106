import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const runtimePath = process.env.PLAYWRIGHT_TEST_PATH;
if (!runtimePath) throw new Error('PLAYWRIGHT_TEST_PATH is required. Run Playwright through pnpm test:e2e.');
const require = createRequire(import.meta.url);
const { expect, test } = require(runtimePath);
const visualCapture = process.env.PR_VISUAL_CAPTURE === '1';
const previewDirectory = resolve('.tmp/pr-previews');
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

test('timed automatic restriction blocks Comenzar before verification and refreshes at expiry', async ({ page, isMobile }) => {
  const expiresAt = Date.now() + 2_500;
  const requests = await installRestrictionContext(page, () => Date.now() < expiresAt
    ? {
      active: true,
      source: 'integrity',
      scope: 'device',
      permanent: false,
      expiresAt: new Date(expiresAt).toISOString(),
      retryAfterSeconds: Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000)),
    }
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
