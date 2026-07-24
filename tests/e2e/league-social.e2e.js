import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const runtimePath = process.env.PLAYWRIGHT_TEST_PATH;
if (!runtimePath) throw new Error('PLAYWRIGHT_TEST_PATH is required. Run Playwright through pnpm test:e2e.');
const require = createRequire(import.meta.url);
const { expect, test } = require(runtimePath);

const visualCapture = process.env.PR_VISUAL_CAPTURE === '1';
const previewRoot = resolve('.tmp/pr-previews');
const apiBaseUrl = 'https://imtitjwgiemlaabpioed.supabase.co/functions/v1/game-api';
const league = Object.freeze({
  code: 'ABC123',
  name: 'Final del barrio',
  revision: 456,
  waiting: true,
  active: false,
  finished: false,
  members: 2,
  participantCount: 2,
  eligibleOwners: 2,
  eligibleDevices: 2,
  participantsNeeded: 1,
  totalAttempts: 0,
  startsAt: null,
  endsAt: null,
  leaderboard: [],
});

function requestBody(request) {
  try {
    return request.postDataJSON() || {};
  } catch {
    return {};
  }
}

async function installMocks(page) {
  await page.addInitScript(() => {
    localStorage.setItem('minuto106:nick', 'Vieucirst');
    localStorage.setItem('minuto106:device-id', 'league-e2e-device-106');
    Object.defineProperty(globalThis.navigator, 'share', {
      configurable: true,
      value: async (payload) => {
        globalThis.__leagueSharePayload = payload;
      },
    });
  });

  await page.route('**/config.js', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `window.__MINUTO106_CONFIG__ = ${JSON.stringify({ apiBaseUrl })};`,
    });
  });

  await page.route('**/functions/v1/game-api', async (route) => {
    const body = requestBody(route.request());
    if (body.action === 'player-leagues') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ ...league, attemptsUsed: 0, attemptsLeft: 5, maxAttempts: 5, rank: null }]),
      });
      return;
    }
    if (body.action === 'league') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(league) });
      return;
    }
    if (body.action === 'league-status') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...league, member: true, attemptsUsed: 0, attemptsLeft: 5, maxAttempts: 5, history: [] }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

async function capture(page, testInfo) {
  if (!visualCapture) return;
  const device = testInfo.project.name.includes('mobile') ? 'mobile' : 'desktop';
  mkdirSync(previewRoot, { recursive: true });
  await page.screenshot({
    path: resolve(previewRoot, `league-waiting-${device}.png`),
    animations: 'disabled',
    fullPage: true,
  });
}

test('waiting league blocks competition and shares a versioned social preview', async ({ page }, testInfo) => {
  await installMocks(page);
  await page.goto('/ligas.html?league=ABC123');

  await expect(page.getByRole('heading', { name: 'Final del barrio · ABC123' })).toBeVisible();
  await expect(page.locator('#leagueLookupEnds')).toHaveText('La cuenta atrás aún no ha empezado');
  await expect(page.locator('#leagueLookupMeta')).toContainText('2/3 cuentas');
  await expect(page.locator('#leagueLookupMeta')).toContainText('2/3 dispositivos');
  await expect(page.locator('#competeLeagueLink')).toBeHidden();
  await expect(page.locator('#leagueLookupList')).toContainText('La clasificación se abrirá cuando empiece la liga.');

  await page.locator('#shareLeagueButton').click();
  await expect.poll(() => page.evaluate(() => globalThis.__leagueSharePayload ?? null)).not.toBeNull();
  const payload = await page.evaluate(() => globalThis.__leagueSharePayload);
  expect(payload.title).toBe('Miniliga Final del barrio');
  expect(payload.url).toMatch(/\/functions\/v1\/social-share\/league\/ABC123\?v=456$/);
  expect(payload.text).toContain('3 cuentas y 3 dispositivos únicos');

  const overflow = await page.evaluate(() => ({
    content: globalThis.document.documentElement.scrollWidth,
    viewport: globalThis.document.documentElement.clientWidth,
  }));
  expect(overflow.content).toBeLessThanOrEqual(overflow.viewport + 1);
  await capture(page, testInfo);
});
