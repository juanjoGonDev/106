import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const runtimePath = process.env.PLAYWRIGHT_TEST_PATH;
if (!runtimePath) throw new Error('PLAYWRIGHT_TEST_PATH is required. Run Playwright through pnpm test:e2e.');
const require = createRequire(import.meta.url);
const { expect, test } = require(runtimePath);

const visualCapture = process.env.PR_VISUAL_CAPTURE === '1';
const previewRoot = resolve('.tmp/pr-previews');
const cardSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="1200" height="630" fill="#08090c"/></svg>';

function profile() {
  return {
    nick: 'Recovery',
    team: 'spain',
    profileRevision: 44,
    attemptsUsed: 2,
    maxAttempts: 5,
    attemptsLeft: 3,
    verifiedAttempts: 2,
    averageDifferenceMs: 130,
    bestDifferenceMs: 60,
    globalRankBest: 4,
    completedReferrals: 0,
    trophies: {
      total: 1,
      days: 1,
      leagueChampion: 0,
      goldenBoot: 1,
      goldenGlove: 0,
      goldenBall: 0,
      history: [{ type: 'golden_boot', date: '2026-07-24', value: 60 }],
    },
    achievements: {
      total: 1,
      points: 10,
      featured: [],
      items: [{
        code: 'first_trophy',
        kind: 'first_trophy',
        title: 'Primer trofeo',
        description: 'Conseguiste tu primer trofeo diario.',
        points: 10,
        date: '2026-07-24',
      }],
    },
    honoursProgress: {
      perfectAttempts: 0,
      verifiedAttempts: 2,
      completedReferrals: 0,
      duelsCreated: 0,
      duelsWon: 0,
      completedLeagues: 0,
      longestTrophyStreak: 1,
      trophyCategoryCount: 1,
      maxDailyTrophyCategories: 1,
      today: {
        attempts: 1,
        bestDifferenceMs: 60,
        averageDifferenceMs: 60,
        goldenBoot: { targetDifferenceMs: 50, leading: false },
        goldenGlove: { requiredAttempts: 3, targetAverageDifferenceMs: null, leading: false },
        goldenBall: { targetAttempts: 2, leading: false },
      },
    },
    history: [{ team: 'spain', elapsedMs: 10_660, differenceMs: 60, verified: true }],
  };
}

function requestBody(request) {
  try {
    return request.postDataJSON() || {};
  } catch {
    return {};
  }
}

async function capture(page, testInfo) {
  if (!visualCapture) return;
  const device = testInfo.project.name.includes('mobile') ? 'mobile' : 'desktop';
  mkdirSync(previewRoot, { recursive: true });
  await page.screenshot({
    path: resolve(previewRoot, `player-profile-recovery-${device}.png`),
    animations: 'disabled',
    fullPage: true,
  });
}

test('public player profile falls back to read-only data and retries full context', async ({ page }, testInfo) => {
  let contextAvailable = false;
  let contextRequests = 0;
  let fallbackRequests = 0;

  await page.route('**/functions/v1/player-share/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: cardSvg });
  });
  await page.route('**/functions/v1/player-context', async (route) => {
    contextRequests += 1;
    if (!contextAvailable) {
      await route.abort('failed');
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ availability: 'owned', profile: profile(), leagues: [] }),
    });
  });
  await page.route('**/functions/v1/game-api', async (route) => {
    const body = requestBody(route.request());
    if (body.action === 'public-profile') {
      fallbackRequests += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(profile()) });
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Acción desconocida.' }) });
  });

  await page.goto('/player/Recovery/achievements');

  await expect(page.getByRole('heading', { level: 1, name: 'Recovery' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Colección y progreso' })).toBeVisible();
  await expect(page.locator('#playerRecoveryNotice')).toBeVisible();
  await expect(page.locator('#playerRecoveryNotice')).toContainText('modo lectura');
  await expect(page.locator('#featuredAchievementsEditor')).toBeHidden();
  expect(contextRequests).toBe(1);
  expect(fallbackRequests).toBe(1);
  await capture(page, testInfo);

  contextAvailable = true;
  await page.getByRole('button', { name: 'Reintentar conexión' }).click();

  await expect(page.locator('#playerRecoveryNotice')).toBeHidden();
  await expect(page.locator('#featuredAchievementsEditor')).toBeVisible();
  expect(contextRequests).toBe(2);
  expect(fallbackRequests).toBe(1);

  const widths = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(widths.content).toBeLessThanOrEqual(widths.viewport + 1);
});
