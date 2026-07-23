import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const runtimePath = process.env.PLAYWRIGHT_TEST_PATH;
if (!runtimePath) throw new Error('PLAYWRIGHT_TEST_PATH is required. Run Playwright through pnpm test:e2e.');
const require = createRequire(import.meta.url);
const { expect, test } = require(runtimePath);
const visualCapture = process.env.PR_VISUAL_CAPTURE === '1';
const previewRoot = resolve('.tmp/pr-previews');

function projectDevice(testInfo) {
  return testInfo.project.name.includes('mobile') ? 'mobile' : 'desktop';
}

async function capture(page, testInfo) {
  if (!visualCapture) return;
  const path = resolve(previewRoot, `home-ranking-${projectDevice(testInfo)}.png`);
  mkdirSync(previewRoot, { recursive: true });
  await page.locator('.leaderboard-card').screenshot({ path, animations: 'disabled' });
}

function requestBody(request) {
  try {
    return request.postDataJSON() || {};
  } catch {
    return {};
  }
}

function stats() {
  return {
    totalAttempts: 30,
    totalPlayers: 8,
    verifiedAttempts: 28,
    perfectAttempts: 0,
    teams: [
      { team: 'spain', score: 292 },
      { team: 'argentina', score: 99 },
    ],
    leaderboard: [
      { nick: 'Vieucirst', team: 'spain', elapsedMs: 10604, differenceMs: 4 },
      { nick: 'NombreMuyMuyMuyLargo123', team: 'argentina', elapsedMs: 10614, differenceMs: 14 },
      { nick: 'Chamuca', team: 'spain', elapsedMs: 10789, differenceMs: 189 },
    ],
    awards: {
      goldenBoot: null,
      goldenGlove: null,
      goldenBall: null,
    },
  };
}

async function installMocks(page) {
  await page.route('**/functions/v1/game-api', async (route) => {
    const body = requestBody(route.request());
    if (body.action === 'stats') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stats()) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

async function expectNoHorizontalOverflow(page) {
  const widths = await page.evaluate(() => ({
    viewport: globalThis.document.documentElement.clientWidth,
    content: globalThis.document.documentElement.scrollWidth,
  }));
  expect(widths.content).toBeLessThanOrEqual(widths.viewport + 1);
}

test('home removes redundant metrics and keeps precision rows on one accessible line', async ({ page }, testInfo) => {
  await installMocks(page);
  await page.goto('/');

  const rows = page.locator('#leaderboard .leaderboard-row-link');
  await expect(rows).toHaveCount(3);
  await expect(page.locator('.stats-strip')).toHaveCount(0);
  await expect(page.getByText('jugadores globales', { exact: true })).toHaveCount(0);
  await expect(page.getByText('intentos globales validados', { exact: true })).toHaveCount(0);
  await expect(page.getByText('tiempos globales perfectos', { exact: true })).toHaveCount(0);

  const first = rows.first();
  const firstFlag = first.locator('img.ranking-flag');
  await expect(firstFlag).toHaveAttribute('alt', 'España');
  await expect(firstFlag).toHaveAttribute('src', /assets\/flag-spain\.svg$/);
  await expect(first).not.toContainText('España');
  await expect(first.locator('.ranking-time')).toHaveText('10.604s');

  const second = rows.nth(1);
  await expect(second.locator('img.ranking-flag')).toHaveAttribute('alt', 'Argentina');
  await expect(second).not.toContainText('Argentina');

  for (const row of await rows.all()) {
    const geometry = await row.evaluate((anchor) => {
      const selectors = ['.rank', '.player-link__nick', '.ranking-flag', '.ranking-time', '.difference'];
      const boxes = selectors.map((selector) => anchor.querySelector(selector)?.getBoundingClientRect()).filter(Boolean);
      const centers = boxes.map((box) => box.top + (box.height / 2));
      const time = anchor.querySelector('.ranking-time');
      const nick = anchor.querySelector('.player-link__nick');
      return {
        height: anchor.getBoundingClientRect().height,
        centerDelta: Math.max(...centers) - Math.min(...centers),
        timeWhiteSpace: globalThis.getComputedStyle(time).whiteSpace,
        nickWhiteSpace: globalThis.getComputedStyle(nick).whiteSpace,
        nickOverflow: globalThis.getComputedStyle(nick).overflow,
      };
    });
    expect(geometry.height).toBeLessThanOrEqual(46);
    expect(geometry.centerDelta).toBeLessThanOrEqual(3);
    expect(geometry.timeWhiteSpace).toBe('nowrap');
    expect(geometry.nickWhiteSpace).toBe('nowrap');
    expect(geometry.nickOverflow).toBe('hidden');
  }

  await expectNoHorizontalOverflow(page);
  await capture(page, testInfo);
});
