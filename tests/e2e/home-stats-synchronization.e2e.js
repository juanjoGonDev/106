import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const runtimePath = process.env.PLAYWRIGHT_TEST_PATH;
if (!runtimePath) throw new Error('PLAYWRIGHT_TEST_PATH is required. Run Playwright through pnpm test:e2e.');
const require = createRequire(import.meta.url);
const { devices, expect, test } = require(runtimePath);
const previewDirectory = '.tmp/pr-previews';
const captureVisualEvidence = process.env.PR_VISUAL_CAPTURE === '1';
const applicationUrl = 'http://127.0.0.1:3000';
const storedConsent = JSON.stringify({ analytics: false, ads: false, updatedAt: '2026-07-26T00:00:00.000Z' });
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

async function installStatsApi(page, initialStats) {
  await page.route('**/functions/v1/game-api', async (route) => {
    const body = bodyOf(route.request());
    if (body.action === 'stats') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(initialStats) });
      return;
    }
    if (body.action === 'access-status') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ exists: false }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

function partialStats() {
  const partial = statsFor('partial');
  delete partial.awards;
  return partial;
}

async function commitStats(page, stats) {
  await page.evaluate((nextStats) => {
    window.Minuto106HomeStats.commit(nextStats, 'finish');
  }, stats);
}

function awardsEvidenceName(isMobile) {
  return `daily-awards-after-finish-${isMobile ? 'mobile' : 'desktop'}`;
}

function recordingContextOptions(isMobile) {
  const device = isMobile
    ? devices['Pixel 5']
    : { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } };
  const videoSize = isMobile
    ? { ...device.viewport }
    : { width: 1280, height: 800 };
  return {
    ...device,
    baseURL: applicationUrl,
    recordVideo: {
      dir: join(previewDirectory, 'recordings'),
      size: videoSize,
    },
    storageState: {
      cookies: [],
      origins: [{
        origin: applicationUrl,
        localStorage: [{ name: 'minuto106:consent-v1', value: storedConsent }],
      }],
    },
  };
}

async function captureEvidence(page, isMobile) {
  if (!captureVisualEvidence) return;
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

test('partial finish snapshots cannot clear valid daily awards', async ({ page, isMobile }) => {
  await installStatsApi(page, statsFor('initial'));
  await page.goto('/?finish-awards=partial', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#goldenBoot')).toContainText('Winnerinitial');
  await expect(page.locator('#goldenGlove')).toContainText('Runnerinitial');
  await expect(page.locator('#goldenBall')).toContainText('Thirdinitial');

  await commitStats(page, partialStats());

  await expect(page.locator('#leaderboard .player-link__nick').first()).toHaveText('Winnerpartial');
  await expect(page.locator('#goldenBoot')).toContainText('Winnerinitial');
  await expect(page.locator('#goldenGlove')).toContainText('Runnerinitial');
  await expect(page.locator('#goldenBall')).toContainText('Thirdinitial');
  await expect(page.locator('#goldenBoot')).not.toContainText('Aún sin dueño');

  if (captureVisualEvidence) {
    await page.screenshot({
      path: join(previewDirectory, `${awardsEvidenceName(isMobile)}.png`),
      fullPage: true,
      animations: 'disabled',
    });
  }

  await commitStats(page, statsFor('complete'));
  await expect(page.locator('#goldenBoot')).toContainText('Winnercomplete');
  await expect(page.locator('#goldenGlove')).toContainText('Runnercomplete');
  await expect(page.locator('#goldenBall')).toContainText('Thirdcomplete');
});

test('records the complete daily-awards refresh lifecycle in the whole viewport', async ({ browser, isMobile }) => {
  test.skip(!captureVisualEvidence, 'Visual recording is generated only by the PR evidence workflow.');
  const context = await browser.newContext(recordingContextOptions(isMobile));
  const page = await context.newPage();
  await installStatsApi(page, statsFor('initial'));
  await page.goto('/?finish-awards=recording', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#goldenBoot')).toContainText('Winnerinitial');
  await page.waitForTimeout(700);

  await commitStats(page, partialStats());
  await expect(page.locator('#leaderboard .player-link__nick').first()).toHaveText('Winnerpartial');
  await expect(page.locator('#goldenBoot')).toContainText('Winnerinitial');
  await expect(page.locator('#goldenBoot')).not.toContainText('Aún sin dueño');
  await page.waitForTimeout(1_200);

  await commitStats(page, statsFor('complete'));
  await expect(page.locator('#goldenBoot')).toContainText('Winnercomplete');
  await expect(page.locator('#goldenGlove')).toContainText('Runnercomplete');
  await expect(page.locator('#goldenBall')).toContainText('Thirdcomplete');
  await page.waitForTimeout(1_200);

  const video = page.video();
  if (!video) throw new Error('Playwright did not create the requested daily-awards recording.');
  await context.close();
  await video.saveAs(join(previewDirectory, `${awardsEvidenceName(isMobile)}.webm`));
});
