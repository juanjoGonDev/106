import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const runtimePath = process.env.PLAYWRIGHT_TEST_PATH;
if (!runtimePath) throw new Error('PLAYWRIGHT_TEST_PATH is required. Run Playwright through pnpm test:e2e.');
const require = createRequire(import.meta.url);
const { expect, test } = require(runtimePath);
const previewDirectory = '.tmp/pr-previews';
mkdirSync(previewDirectory, { recursive: true });

function achievement(index, overrides = {}) {
  return {
    code: `verified_total_${index}`,
    kind: 'verified_total',
    title: `Logro ${index}`,
    description: `Descripción ${index}`,
    points: index,
    date: `2026-08-${String(Math.min(28, index)).padStart(2, '0')}`,
    ...overrides,
  };
}

function profile() {
  const history = Array.from({ length: 23 }, (_, index) => ({
    id: `attempt-${index + 1}`,
    team: index % 2 === 0 ? 'spain' : 'argentina',
    elapsedMs: 10_600 + index,
    differenceMs: index,
    verified: true,
  }));
  const achievements = [
    achievement(1, {
      code: 'daily_hat_trick_2026-08-10',
      kind: 'daily_hat_trick',
      title: 'Triplete diario',
      points: 50,
      date: '2026-08-10',
    }),
    achievement(2, {
      code: 'daily_hat_trick_2026-08-09',
      kind: 'daily_hat_trick',
      title: 'Triplete diario',
      points: 50,
      date: '2026-08-09',
    }),
    achievement(3, {
      code: 'daily_hat_trick_2026-08-08',
      kind: 'daily_hat_trick',
      title: 'Triplete diario',
      points: 50,
      date: '2026-08-08',
    }),
    ...Array.from({ length: 18 }, (_, index) => achievement(index + 4)),
  ];
  const trophies = Array.from({ length: 22 }, (_, index) => ({
    type: index % 3 === 0 ? 'golden_boot' : index % 3 === 1 ? 'golden_glove' : 'golden_ball',
    date: `2026-07-${String(31 - index).padStart(2, '0')}`,
    value: index + 1,
  }));

  return {
    nick: 'PagedPlayer',
    team: 'spain',
    profileRevision: 'fixture-v1',
    bestDifferenceMs: 0,
    averageDifferenceMs: 123,
    globalRankBest: 1,
    verifiedAttempts: history.length,
    history,
    trophies: {
      total: trophies.length,
      days: trophies.length,
      goldenBoot: 8,
      goldenGlove: 7,
      goldenBall: 7,
      leagueChampion: 0,
      history: trophies,
    },
    achievements: {
      total: achievements.length,
      points: achievements.reduce((sum, item) => sum + item.points, 0),
      items: achievements,
      featured: [],
    },
    honoursProgress: {
      verifiedAttempts: history.length,
      perfectAttempts: 1,
      bestDifferenceMs: 0,
      totalTrophies: trophies.length,
      goldenBoot: 8,
      goldenGlove: 7,
      goldenBall: 7,
      longestTrophyStreak: 1,
      trophyCategoryCount: 3,
      maxDailyTrophyCategories: 3,
      completedReferrals: 0,
      duelsCreated: 0,
      duelsWon: 0,
      completedLeagues: 0,
    },
  };
}

function requestBody(route) {
  try {
    return route.request().postDataJSON() || {};
  } catch {
    return {};
  }
}

async function installProfileMocks(page) {
  const player = profile();
  await page.route('**/functions/v1/player-context', async (route) => {
    const body = requestBody(route);
    if (body.action === 'set-featured-achievements') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ availability: 'owned', profile: player, leagues: [] }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ availability: 'owned', profile: player, leagues: [] }),
    });
  });
  await page.route('**/functions/v1/game-api', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(player) });
  });
  await page.route('**/functions/v1/player-share**', async (route) => {
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });
}

function playerPath(section = 'overview') {
  return section === 'overview'
    ? '/player/PagedPlayer'
    : `/player/PagedPlayer/${encodeURIComponent(section)}`;
}

async function openPlayer(page, section = 'overview') {
  await installProfileMocks(page);
  await page.goto(playerPath(section));
  await expect(page.locator('#playerContent')).toBeVisible();
}

test('attempt and trophy histories stay bounded and navigate deterministically', async ({ page }) => {
  await openPlayer(page);
  await expect(page.locator('#playerHistory > li')).toHaveCount(10);
  await expect(page.locator('#playerHistoryPager')).toContainText('1–10 de 23');
  await page.locator('#playerHistoryPager [data-page-direction="next"]').click();
  await expect(page.locator('#playerHistoryPager')).toContainText('11–20 de 23');
  await page.locator('#playerHistoryPager [data-page-direction="next"]').click();
  await expect(page.locator('#playerHistory > li')).toHaveCount(3);
  await expect(page.locator('#playerHistoryPager')).toContainText('21–23 de 23');

  await page.goto(playerPath('trophies'));
  await expect(page.locator('#playerContent')).toBeVisible();
  await expect(page.locator('#playerTrophyCollection > li')).toHaveCount(4);
  await expect(page.locator('#playerTrophies > li')).toHaveCount(10);
  await expect(page.locator('#playerTrophiesPager')).toContainText('1–10 de 22');
  await page.locator('#playerTrophiesPager [data-page-direction="next"]').click();
  await expect(page.locator('#playerTrophiesPager')).toContainText('11–20 de 22');
});

test('repeated achievements are grouped with dates collapsed by default and the collection paginates', async ({ page }) => {
  await openPlayer(page, 'achievements');
  await expect(page.locator('#playerAchievements > li')).toHaveCount(10);
  await expect(page.locator('#playerAchievementsPager')).toContainText('1–10 de');

  const repeated = page.locator('#playerAchievements [data-achievement-code^="daily_hat_trick"]');
  await expect(repeated).toHaveCount(1);
  const details = repeated.locator('details.honours-occurrences');
  await expect(details).toHaveCount(1);
  await expect(details).not.toHaveAttribute('open', '');
  await expect(details.locator('summary')).toContainText('3 fechas conseguidas');
  await details.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(details).toHaveAttribute('open', '');
  await expect(details.locator('li')).toHaveCount(3);

  await page.locator('#playerAchievementsPager [data-page-direction="next"]').click();
  await expect(page.locator('#playerAchievementsPager')).toContainText('página 2 de');
});

test('profile collection controls remain within a 320px viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await openPlayer(page, 'achievements');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.locator('#playerAchievementsPager button')).toHaveCount(2);
  await expect(page.locator('#playerAchievementsPager button').first()).toHaveCSS('min-height', '44px');
});
