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
    attemptsUsed: 5,
    verifiedAttempts: 5,
    averageDifferenceMs: 250,
    bestDifferenceMs: 4,
    globalRankBest: 1,
    completedReferrals: 2,
    bonusAttempts: 1,
    trophies: { total: 3, days: 2, history: [] },
    achievements: { total: 3, points: 60, items: [] },
    history: [],
  };
}

async function installMocks(page) {
  await page.route('**/functions/v1/player-share/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"></svg>' });
  });
  await page.route('**/functions/v1/game-api', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(profile()) });
  });
}

async function capture(page, testInfo) {
  if (!visualCapture) return;
  const device = testInfo.project.name.includes('mobile') ? 'mobile' : 'desktop';
  const directory = resolve('.tmp/pr-previews');
  mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: resolve(directory, `player-navigation-${device}.png`), animations: 'disabled', fullPage: true });
}

test('player clean routes keep home navigation anchored to the application root', async ({ page }, testInfo) => {
  await installMocks(page);
  await page.goto('/player/Vieucirst');
  await expect(page.getByRole('heading', { level: 1, name: 'Vieucirst' })).toBeVisible();

  const brand = page.locator('.site-header .brand');
  const firstNavigationLink = page.locator('.site-navigation a').first();
  const brandHref = await brand.getAttribute('href');
  const firstNavigationHref = await firstNavigationLink.getAttribute('href');

  expect(new URL(brandHref, page.url()).pathname).toBe('/');
  expect(new URL(firstNavigationHref, page.url()).pathname).toBe('/');
  await capture(page, testInfo);

  await brand.click();
  await expect(page).toHaveURL((url) => url.pathname === '/');
});
