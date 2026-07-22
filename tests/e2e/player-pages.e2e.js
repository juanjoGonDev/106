import { createRequire } from 'node:module';

const runtimePath = process.env.PLAYWRIGHT_TEST_PATH;
if (!runtimePath) throw new Error('PLAYWRIGHT_TEST_PATH is required. Run Playwright through pnpm test:e2e.');
const require = createRequire(import.meta.url);
const { expect, test } = require(runtimePath);

const apiUrl = 'https://imtitjwgiemlaabpioed.supabase.co/functions/v1/game-api';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2rWQAAAAASUVORK5CYII=', 'base64');

function profile(nick = 'Vieucirst') {
  return {
    nick,
    team: 'spain',
    attemptsUsed: 5,
    maxAttempts: 5,
    attemptsLeft: 0,
    verifiedAttempts: 5,
    averageDifferenceMs: 250,
    bestDifferenceMs: 4,
    globalRankAverage: 2,
    globalRankBest: 1,
    totalPlayers: 30,
    completedReferrals: 2,
    bonusAttempts: 1,
    trophies: {
      total: 3,
      days: 2,
      goldenBoot: 1,
      goldenGlove: 1,
      goldenBall: 1,
      rank: 1,
      history: [
        { type: 'golden_boot', date: '2026-07-21', value: 4 },
        { type: 'golden_ball', date: '2026-07-20', value: 5 },
      ],
    },
    achievements: {
      total: 3,
      points: 60,
      rank: 1,
      items: [
        { code: 'first', title: 'Primer trofeo', description: 'Conseguiste tu primer trofeo diario.', points: 10, date: '2026-07-21' },
        { code: 'month', title: 'Primero del mes', description: 'Fuiste el primer ganador mensual.', points: 25, date: '2026-07-20' },
      ],
    },
    history: [
      { team: 'spain', elapsedMs: 10604, differenceMs: 4, verified: true },
      { team: 'argentina', elapsedMs: 10850, differenceMs: 250, verified: true },
    ],
  };
}

function stats(awardNick) {
  return {
    totalAttempts: 30,
    totalPlayers: 8,
    verifiedAttempts: 28,
    perfectAttempts: 0,
    teams: [
      { team: 'spain', score: 60 },
      { team: 'argentina', score: 40 },
    ],
    leaderboard: [
      { nick: 'Vieucirst', team: 'spain', elapsedMs: 10604, differenceMs: 4 },
      { nick: 'Snogak', team: 'argentina', elapsedMs: 10614, differenceMs: 14 },
    ],
    awards: {
      goldenBoot: { nick: awardNick, team: 'spain', value: 4 },
      goldenGlove: { nick: 'Snogak', team: 'argentina', value: 14 },
      goldenBall: { nick: 'Vieucirst', team: 'spain', value: 5 },
    },
    honoursRankings: {
      trophies: [{ rank: 1, nick: 'Vieucirst', team: 'spain', totalTrophies: 3, trophyDays: 2, goldenBoot: 1, goldenGlove: 1, goldenBall: 1, achievementPoints: 60 }],
      achievements: [{ rank: 1, nick: 'Vieucirst', team: 'spain', achievementPoints: 60, totalAchievements: 3, totalTrophies: 3 }],
    },
  };
}

function requestBody(request) {
  try {
    return request.postDataJSON() || {};
  } catch {
    return {};
  }
}

async function installMocks(page, currentAward) {
  await page.route('**/functions/v1/player-share/**', async (route) => {
    if (route.request().url().endsWith('.png')) {
      await route.fulfill({ status: 200, contentType: 'image/png', body: png });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Jugador</title>' });
  });
  await page.route('**/functions/v1/game-api', async (route) => {
    const body = requestBody(route.request());
    if (body.action === 'stats') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stats(currentAward.value)) });
      return;
    }
    if (['profile', 'public-profile', 'nick-status'].includes(body.action)) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(profile(body.nick || 'Vieucirst')) });
      return;
    }
    if (body.action === 'finish') {
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ stats: stats(currentAward.value), profile: profile(), attempt: { verified: true } }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

async function expectNoHorizontalOverflow(page) {
  const widths = await page.evaluate(() => {
    const root = globalThis.document.documentElement;
    return { viewport: root.clientWidth, content: root.scrollWidth };
  });
  expect(widths.content).toBeLessThanOrEqual(widths.viewport + 1);
}

test('clean player routes expose responsive overview, achievements and trophies', async ({ page }) => {
  const currentAward = { value: 'Vieucirst' };
  await installMocks(page, currentAward);
  await page.goto('/player/Vieucirst');

  await expect(page).toHaveURL(/\/player\/Vieucirst$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Vieucirst' })).toBeVisible();
  await expect(page.locator('#playerTeam .flag--spain')).toBeVisible();
  await expect(page.locator('#playerRadar svg')).toBeVisible();
  await expect(page.locator('#playerCardPreview')).toHaveAttribute('src', /player-share\/Vieucirst\/card\.png$/);
  await expectNoHorizontalOverflow(page);

  const shareCursor = await page.locator('#sharePlayer').evaluate((element) => globalThis.getComputedStyle(element).cursor);
  const tabCursor = await page.getByRole('link', { name: 'Logros' }).evaluate((element) => globalThis.getComputedStyle(element).cursor);
  expect(shareCursor).toBe('pointer');
  expect(tabCursor).toBe('pointer');

  await page.getByRole('link', { name: 'Logros' }).click();
  await expect(page).toHaveURL(/\/player\/Vieucirst\/achievements$/);
  await expect(page.getByRole('heading', { name: 'Logros desbloqueados' })).toBeVisible();
  const description = page.locator('#playerAchievements small').first();
  const date = page.locator('#playerAchievements time').first();
  await expect(description).toBeVisible();
  await expect(date).toBeVisible();
  const [descriptionBox, dateBox] = await Promise.all([description.boundingBox(), date.boundingBox()]);
  expect(dateBox.y).toBeGreaterThanOrEqual(descriptionBox.y + descriptionBox.height);
  await expectNoHorizontalOverflow(page);

  await page.getByRole('link', { name: 'Trofeos' }).click();
  await expect(page).toHaveURL(/\/player\/Vieucirst\/trophies$/);
  await expect(page.getByRole('heading', { name: 'Trofeos conseguidos' })).toBeVisible();
  await expect(page.locator('#playerTrophies time').first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('dedicated precision, trophy and achievement rankings always show flags and profile links', async ({ page }) => {
  const currentAward = { value: 'Vieucirst' };
  await installMocks(page, currentAward);
  await page.goto('/ranking.html');

  const precision = page.locator('#fullRanking .leaderboard-row-link').first();
  await expect(precision).toHaveAttribute('href', /\/player\/Vieucirst$/);
  await expect(precision.locator('.flag--spain')).toBeVisible();

  await page.getByRole('tab', { name: 'Trofeos' }).click();
  const trophies = page.locator('#trophyLeaderboard .leaderboard-row-link').first();
  await expect(trophies).toHaveAttribute('href', /\/player\/Vieucirst\/trophies$/);
  await expect(trophies.locator('.flag--spain')).toBeVisible();

  await page.getByRole('tab', { name: 'Logros' }).click();
  const achievements = page.locator('#achievementLeaderboard .leaderboard-row-link').first();
  await expect(achievements).toHaveAttribute('href', /\/player\/Vieucirst\/achievements$/);
  await expect(achievements.locator('.flag--spain')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('finishing an attempt refreshes sidebar ranking and daily awards without a reload', async ({ page, isMobile }) => {
  const currentAward = { value: 'Antes' };
  await installMocks(page, currentAward);
  await page.goto('/');

  const rankingFlag = page.locator('#leaderboard .flag--spain').first();
  const awardFlag = page.locator('#goldenBoot .flag--spain');
  await expect(page.locator('#leaderboard .leaderboard-row-link').first()).toHaveAttribute('href', /\/player\/Vieucirst$/);
  await expect(rankingFlag).toHaveCount(1);
  await expect(page.locator('#goldenBoot .award-player-link')).toContainText('Antes');
  await expect(awardFlag).toHaveCount(1);
  if (!isMobile) {
    await expect(rankingFlag).toBeVisible();
    await expect(awardFlag).toBeVisible();
  }

  currentAward.value = 'Después';
  await page.evaluate(async (url) => {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'finish', challengeId: 'e2e' }),
    });
  }, apiUrl);

  await expect(page.locator('#goldenBoot .award-player-link')).toContainText('Después');
  await expect(page.locator('#goldenBoot .award-player-link')).toHaveAttribute('href', /\/player\/Despu%C3%A9s$/);
  await expectNoHorizontalOverflow(page);
});