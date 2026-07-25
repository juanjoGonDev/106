import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const runtimePath = process.env.PLAYWRIGHT_TEST_PATH;
if (!runtimePath) throw new Error('PLAYWRIGHT_TEST_PATH is required. Run Playwright through pnpm test:e2e.');
const require = createRequire(import.meta.url);
const { expect, test } = require(runtimePath);
const previewDirectory = '.tmp/pr-previews';
mkdirSync(previewDirectory, { recursive: true });

function bodyOf(request) {
  try {
    return request.postDataJSON() || {};
  } catch {
    return {};
  }
}

function statsFor(id) {
  return {
    totalAttempts: 1_987,
    totalPlayers: 42,
    verifiedAttempts: 1_901,
    perfectAttempts: 3,
    teams: [
      { team: 'spain', score: 1_404 },
      { team: 'argentina', score: 996 },
    ],
    leaderboard: [
      { nick: `Winner${id}`, team: 'spain', elapsedMs: 10_600, differenceMs: 0 },
      { nick: `Runner${id}`, team: 'argentina', elapsedMs: 10_604, differenceMs: 4 },
      { nick: `Third${id}`, team: 'spain', elapsedMs: 10_611, differenceMs: 11 },
    ],
    awards: {
      goldenBoot: { nick: `Winner${id}`, team: 'spain', value: 0 },
      goldenGlove: { nick: `Runner${id}`, team: 'argentina', value: 4 },
      goldenBall: { nick: `Third${id}`, team: 'spain', value: 5 },
    },
  };
}

async function captureEvidence(page, isMobile) {
  if (process.env.PR_VISUAL_CAPTURE !== '1') return;
  await page.screenshot({
    path: `${previewDirectory}/home-stats-synchronization-${isMobile ? 'mobile' : 'desktop'}.png`,
    fullPage: true,
    animations: 'disabled',
  });
}

test('sequential delayed loads use one Supabase stats request and commit a complete stable home', async ({ page, isMobile }) => {
  const cases = [
    { id: 'instant', delayMs: 0 },
    { id: 'short', delayMs: 35 },
    { id: 'medium', delayMs: 140 },
    { id: 'slow', delayMs: 420 },
  ];
  const requestCounts = new Map(cases.map(({ id }) => [id, 0]));
  let activeCase = cases[0];

  await page.route('**/functions/v1/game-api', async (route) => {
    const body = bodyOf(route.request());
    if (body.action === 'stats') {
      requestCounts.set(activeCase.id, requestCounts.get(activeCase.id) + 1);
      await new Promise((resolve) => setTimeout(resolve, activeCase.delayMs));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(statsFor(activeCase.id)),
      });
      return;
    }

    if (body.action === 'access-status') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ exists: false }) });
      return;
    }

    if (body.action === 'profile' || body.action === 'public-profile' || body.action === 'nick-status') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ nick: body.nick || '', team: 'spain', history: [], attemptsUsed: 0, maxAttempts: 5, attemptsLeft: 5 }),
      });
      return;
    }

    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  for (const testCase of cases) {
    activeCase = testCase;
    await page.goto(`/?home-sync=${testCase.id}`, { waitUntil: 'domcontentloaded' });

    const leaderboard = page.locator('#leaderboard');
    await expect(leaderboard).toHaveAttribute('data-render-state', 'ready', { timeout: 5_000 });
    await expect(leaderboard).not.toHaveAttribute('aria-busy', 'true');
    await expect(leaderboard.locator(':scope > li')).toHaveCount(3);
    await expect(leaderboard.locator('.player-link__nick')).toHaveText([
      `Winner${testCase.id}`,
      `Runner${testCase.id}`,
      `Third${testCase.id}`,
    ]);
    await expect(leaderboard.locator('.ranking-time')).toHaveText(['10.600s', '10.604s', '10.611s']);
    await expect(leaderboard.locator('.ranking-flag')).toHaveCount(3);
    await expect(leaderboard.locator('.ranking-flag').first()).toHaveAttribute('aria-label', 'España');

    await expect(page.locator('#spainScore')).toHaveText('1.4K');
    await expect(page.locator('#spainScore')).toHaveAttribute('title', '1.404');
    await expect(page.locator('#argentinaScore')).toHaveText('996');
    await expect(page.locator('#totalAttempts')).toHaveCount(0);

    await page.waitForTimeout(testCase.delayMs + 250);
    await expect(leaderboard).toHaveAttribute('data-render-state', 'ready');
    await expect(leaderboard.locator('.player-link__nick').first()).toHaveText(`Winner${testCase.id}`);
    await expect(page.locator('#spainScore')).toHaveText('1.4K');
    expect(requestCounts.get(testCase.id)).toBe(1);

    if (testCase.id === 'slow') await captureEvidence(page, isMobile);
    await page.waitForTimeout(80);
  }
});
