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

function profileCardFixtureSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <rect width="1200" height="630" rx="32" fill="#090d15"/>
    <text x="72" y="100" fill="#f4c95d" font-family="Arial" font-size="22" font-weight="700">MINUTO 106 · PERFIL GLOBAL</text>
    <text x="72" y="190" fill="#ffffff" font-family="Arial" font-size="64" font-weight="800">PagedPlayer</text>
    <text x="72" y="255" fill="#d4d7df" font-family="Arial" font-size="28">Logros y palmarés actualizados</text>
    <circle cx="940" cy="315" r="160" fill="#111722" stroke="#f4c95d" stroke-width="6"/>
    <text x="940" y="330" text-anchor="middle" fill="#ffffff" font-family="Arial" font-size="54" font-weight="800">10.600</text>
  </svg>`;
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
      code: 'daily_hat_trick_2026-08-30',
      kind: 'daily_hat_trick',
      title: 'Triplete diario',
      points: 50,
      date: '2026-08-30',
    }),
    achievement(2, {
      code: 'daily_hat_trick_2026-08-29',
      kind: 'daily_hat_trick',
      title: 'Triplete diario',
      points: 50,
      date: '2026-08-29',
    }),
    achievement(3, {
      code: 'daily_hat_trick_2026-08-28',
      kind: 'daily_hat_trick',
      title: 'Triplete diario',
      points: 50,
      date: '2026-08-28',
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
    await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: profileCardFixtureSvg() });
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

function evidenceDevice(isMobile) {
  return isMobile ? 'mobile' : 'desktop';
}

function recordingContextOptions(isMobile) {
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

async function saveVideo(context, page, area, isMobile) {
  const video = page.video();
  if (!video) throw new Error(`Playwright did not create the ${area} recording.`);
  await context.close();
  await video.saveAs(join(previewDirectory, `${area}-${evidenceDevice(isMobile)}.webm`));
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

test('records grouped achievement disclosure and pagination as changed-area evidence', async ({ browser, isMobile }) => {
  test.skip(!visualCapture, 'Visual recording is generated only by the PR evidence workflow.');
  const context = await browser.newContext(recordingContextOptions(isMobile));
  const page = await context.newPage();
  await installProfileMocks(page);
  await page.goto(playerPath('achievements'));
  await expect(page.locator('#playerContent')).toBeVisible();
  await expect.poll(() => page.locator('#playerCardPreview').evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);

  const repeated = page.locator('#playerAchievements [data-achievement-code^="daily_hat_trick"]');
  const details = repeated.locator('details.honours-occurrences');
  const summary = details.locator('summary');
  await expect(repeated).toHaveCount(1);
  await expect(details).not.toHaveAttribute('open', '');
  await summary.scrollIntoViewIfNeeded();
  await summary.click();
  await expect(details).toHaveAttribute('open', '');
  await expect(details.locator('li')).toHaveCount(3);

  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);

  const device = evidenceDevice(isMobile);
  await page.screenshot({
    path: join(previewDirectory, `player-collections-${device}.png`),
    animations: 'disabled',
    fullPage: true,
  });

  await page.locator('#playerAchievementsPager [data-page-direction="next"]').click();
  await expect(page.locator('#playerAchievementsPager')).toContainText('página 2 de');
  await page.locator('#playerAchievementsPager [data-page-direction="previous"]').click();
  await expect(page.locator('#playerAchievementsPager')).toContainText('página 1 de');
  await expect(page.locator('#playerAchievements [data-achievement-code^="daily_hat_trick"]')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);

  await saveVideo(context, page, 'player-collections', isMobile);
});
