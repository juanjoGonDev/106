import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const runtimePath = process.env.PLAYWRIGHT_TEST_PATH;
if (!runtimePath) throw new Error('PLAYWRIGHT_TEST_PATH is required. Run Playwright through pnpm test:e2e.');
const require = createRequire(import.meta.url);
const { expect, test } = require(runtimePath);
const visualCapture = process.env.PR_VISUAL_CAPTURE === '1';

function profile() {
  return {
    nick: 'Vieucirst',
    team: 'spain',
    attemptsUsed: 17,
    verifiedAttempts: 17,
    averageDifferenceMs: 250,
    bestDifferenceMs: 4,
    globalRankBest: 1,
    completedReferrals: 0,
    bonusAttempts: 1,
    trophies: { total: 4, days: 2, goldenBoot: 1, goldenGlove: 1, goldenBall: 1, leagueChampion: 1, history: [] },
    achievements: { total: 12, points: 291, items: [], featured: [] },
    honoursProgress: { today: {} },
    history: [],
  };
}

async function installMocks(page) {
  await page.route('**/functions/v1/player-share/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"></svg>' });
  });
  await page.route('**/functions/v1/player-context', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ availability: 'occupied', profile: profile(), leagues: [] }),
    });
  });
}

async function capture(page, testInfo) {
  if (!visualCapture) return;
  const device = testInfo.project.name.includes('mobile') ? 'mobile' : 'desktop';
  const directory = resolve('.tmp/pr-previews');
  mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: resolve(directory, `player-navigation-${device}.png`), animations: 'disabled', fullPage: true });
}

test('player clean routes keep home navigation anchored and explain impact progression', async ({ page }, testInfo) => {
  await installMocks(page);
  const pageErrors = [];
  const consoleErrors = [];
  const failedRequests = [];
  const cleanRouteAssetLeaks = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('requestfailed', (request) => failedRequests.push(`${request.method()} ${request.url()}`));
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith('/player/assets/') || pathname === '/player/share-actions.js') {
      cleanRouteAssetLeaks.push(pathname);
    }
  });

  await page.goto('/player/Vieucirst');
  await expect(page.getByRole('heading', { level: 1, name: 'Vieucirst' })).toBeVisible();
  await expect(page.getByText('Cómo subir Impacto')).toBeVisible();
  await expect(page.locator('#playerRadarExplanation')).toHaveText('Impacto 8/100 · 0 referidos completados · +1 intento diario adicional. Cada referido completado suma 20 puntos y cada intento diario adicional suma 8.');

  const brand = page.locator('.site-header .brand');
  const firstNavigationLink = page.locator('.site-navigation a').first();
  const brandHref = await brand.getAttribute('href');
  const firstNavigationHref = await firstNavigationLink.getAttribute('href');

  expect(new URL(brandHref, page.url()).pathname).toBe('/');
  expect(new URL(firstNavigationHref, page.url()).pathname).toBe('/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  expect(cleanRouteAssetLeaks).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
  await capture(page, testInfo);

  await brand.click();
  await expect(page).toHaveURL((url) => url.pathname === '/');
});
