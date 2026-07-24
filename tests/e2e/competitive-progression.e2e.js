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

function stats() {
  return {
    targetMs: 10600,
    totalAttempts: 42,
    totalPlayers: 12,
    verifiedAttempts: 39,
    perfectAttempts: 2,
    teams: [
      { team: 'spain', score: 350 },
      { team: 'argentina', score: 310 },
    ],
    leaderboard: [
      {
        rank: 1,
        nick: 'TieMaster',
        team: 'spain',
        elapsedMs: 10604,
        differenceMs: 4,
        achievementPoints: 210,
        dailyTrophies: 4,
        leagueWins: 1,
        verifiedAttempts: 34,
        averageDifferenceMs: 62,
        tiedOnTime: true,
      },
      {
        rank: 2,
        nick: 'TieRival',
        team: 'argentina',
        elapsedMs: 10596,
        differenceMs: 4,
        achievementPoints: 180,
        dailyTrophies: 5,
        leagueWins: 3,
        verifiedAttempts: 58,
        averageDifferenceMs: 41,
        tiedOnTime: true,
      },
    ],
    awards: {
      goldenBoot: { nick: 'TieMaster', team: 'spain', value: 4 },
      goldenGlove: { nick: 'TieRival', team: 'argentina', value: 41 },
      goldenBall: { nick: 'TieRival', team: 'argentina', value: 5 },
    },
    honoursRankings: {
      trophies: [],
      achievements: [],
    },
  };
}

function ownedProfile(nick, attemptsLeft) {
  return {
    nick,
    team: 'spain',
    attemptsUsed: 5 - attemptsLeft,
    attemptsLeft,
    maxAttempts: 5,
    verifiedAttempts: 5 - attemptsLeft,
    history: [],
    trophies: { total: 0, history: [] },
    achievements: { total: 0, points: 0, items: [], featured: [] },
  };
}

function honoursProfile(featuredCodes = ['perfect_total_1'], revision = 1) {
  const items = [
    { code: 'perfect_total_1', kind: 'perfect_total', title: 'Primer latido perfecto', description: 'Clavaste el 10.600.', points: 15, date: '2026-07-24' },
    { code: 'verified_total_10', kind: 'verified_total', title: 'Doble prórroga', description: 'Completaste diez intentos válidos.', points: 18, date: '2026-07-23' },
    { code: 'referral_total_1', kind: 'referral_total', title: 'Primer fichaje', description: 'Conseguiste una invitación completada.', points: 15, date: '2026-07-22' },
    { code: 'duel_wins_1', kind: 'duel_wins', title: 'Primer duelo ganado', description: 'Ganaste un reto directo.', points: 20, date: '2026-07-21' },
  ];
  return {
    nick: 'Owner',
    team: 'spain',
    attemptsUsed: 5,
    attemptsLeft: 0,
    maxAttempts: 5,
    verifiedAttempts: 12,
    bestDifferenceMs: 80,
    averageDifferenceMs: 120,
    globalRankBest: 7,
    profileRevision: revision,
    completedReferrals: 1,
    history: [{ team: 'spain', elapsedMs: 10680, differenceMs: 80, verified: true }],
    trophies: {
      total: 2,
      days: 2,
      goldenBoot: 1,
      goldenGlove: 1,
      goldenBall: 0,
      leagueChampion: 0,
      history: [],
    },
    achievements: {
      total: items.length,
      points: items.reduce((sum, item) => sum + item.points, 0),
      items,
      featured: featuredCodes.map((code, index) => ({ ...items.find((item) => item.code === code), position: index + 1 })),
    },
    honoursProgress: {
      perfectAttempts: 1,
      verifiedAttempts: 12,
      completedReferrals: 1,
      duelsCreated: 2,
      duelsWon: 1,
      completedLeagues: 0,
      longestTrophyStreak: 1,
      trophyCategoryCount: 2,
      maxDailyTrophyCategories: 1,
      today: {
        attempts: 2,
        bestDifferenceMs: 80,
        averageDifferenceMs: 120,
        goldenBoot: { targetDifferenceMs: 50, leading: false },
        goldenGlove: { requiredAttempts: 3, targetAverageDifferenceMs: 90, leading: false },
        goldenBall: { targetAttempts: 4, leading: false },
      },
    },
  };
}

function activeLeague() {
  return {
    publicId: 'RCY9EY',
    competitionCode: 'RCY9EY',
    name: 'Liga de precisión',
    active: true,
    waiting: false,
    finished: false,
    attemptsUsed: 2,
    attemptsLeft: 3,
    maxAttempts: 5,
    verifiedAttempts: 2,
    bestDifferenceMs: 8,
    rank: 2,
  };
}

async function installStatsMock(page) {
  await page.route('**/functions/v1/game-api', async (route) => {
    const body = bodyOf(route.request());
    if (body.action === 'stats') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stats()) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

async function capture(page, name, isMobile, locator = 'body') {
  if (process.env.PR_VISUAL_CAPTURE !== '1') return;
  await page.locator(locator).screenshot({
    path: `${previewDirectory}/${name}-${isMobile ? 'mobile' : 'desktop'}.png`,
    animations: 'disabled',
  });
}

test('nickname debounce rejects stale input and an exhausted global scope stays selected', async ({ page, isMobile }) => {
  const requestedNicks = [];
  await installStatsMock(page);
  await page.route('**/functions/v1/player-context', async (route) => {
    const body = bodyOf(route.request());
    const nick = String(body.nick || '');
    requestedNicks.push(nick);
    if (nick === 'Ocupado') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          availability: 'occupied',
          profile: ownedProfile(nick, 2),
          leagues: [],
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        availability: 'owned',
        profile: ownedProfile(nick, 0),
        leagues: [activeLeague()],
      }),
    });
  });

  await page.goto('/');
  const nick = page.locator('#nick');
  await nick.fill('O');
  await page.waitForTimeout(110);
  await nick.fill('Oc');
  await page.waitForTimeout(110);
  await nick.fill('Ocu');
  await page.waitForTimeout(110);
  await nick.fill('Ocupado');

  await expect(page.locator('#nickStatus')).toContainText('ocupado');
  expect(requestedNicks).toEqual(['Ocupado']);
  await page.getByRole('button', { name: 'España', exact: true }).click();
  await expect(page.locator('#startButton')).toBeDisabled();

  await nick.fill('Owner');
  await expect(page.locator('#competitionPicker')).toHaveValue('global');
  await expect(page.locator('#nickStatus')).toContainText('agotado');
  await expect(page.locator('#startButton')).toBeDisabled();
  await expect(page.locator('#competitionPicker option')).toHaveCount(2);

  await page.locator('#competitionPicker').selectOption('league:RCY9EY');
  await expect(page.locator('#nickStatus')).toContainText('3 de 5 intentos disponibles');
  await expect(page.locator('#startButton')).toBeEnabled();
  await page.evaluate(() => localStorage.setItem('minuto106:nick', 'Owner'));
  await capture(page, 'home-competition-selector', isMobile, '#setup');

  await page.reload();
  await expect(page.locator('#nick')).toHaveValue('Owner');
  await expect(page.locator('#competitionPicker')).toHaveValue('league:RCY9EY');
  await expect(page.locator('#competitionContext')).toBeVisible();
});

test('the dedicated ranking explains and displays exact time tie-break evidence', async ({ page, isMobile }) => {
  await installStatsMock(page);
  await page.goto('/ranking.html');

  await expect(page.getByRole('heading', { name: 'Cómo se ordena la precisión' })).toBeVisible();
  const tiedRows = page.locator('#fullRanking .ranking-time-tie');
  await expect(tiedRows).toHaveCount(2);
  await expect(tiedRows.nth(0).locator('.ranking-tiebreak')).toContainText('210 pt');
  await expect(tiedRows.nth(0).locator('.ranking-tiebreak')).toContainText('4 trofeos diarios');
  await expect(tiedRows.nth(1).locator('.ranking-tiebreak')).toContainText('180 pt');
  await expect(tiedRows.nth(1).locator('.ranking-tiebreak')).toContainText('58 intentos válidos');
  await capture(page, 'ranking-tiebreak', isMobile, '.page-card');
});

test('a clean public league route renders without a nickname or private join key', async ({ page, isMobile }) => {
  const privateJoinCode = 'JOIN99';
  await page.route('**/functions/v1/game-api', async (route) => {
    const body = bodyOf(route.request());
    if (body.action === 'league') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          publicId: 'RCY9EY',
          code: 'RCY9EY',
          name: 'Torneo RCY9EY',
          active: true,
          waiting: false,
          finished: false,
          startsAt: '2026-07-24T18:00:00.000Z',
          endsAt: '2026-07-27T18:00:00.000Z',
          createdAt: '2026-07-24T17:30:00.000Z',
          members: 5,
          participantCount: 5,
          eligibleOwners: 5,
          eligibleDevices: 5,
          totalAttempts: 14,
          revision: 1784916000000,
          leaderboard: [
            { rank: 1, nick: 'Campeón', attemptsUsed: 5, verifiedAttempts: 5, bestDifferenceMs: 3 },
            { rank: 2, nick: 'Finalista', attemptsUsed: 4, verifiedAttempts: 4, bestDifferenceMs: 7 },
            { rank: 3, nick: 'Podio', attemptsUsed: 5, verifiedAttempts: 5, bestDifferenceMs: 11 },
          ],
        }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.goto('/ligas/RCY9EY');
  await expect(page).toHaveURL(/\/ligas\/RCY9EY$/);
  await expect(page.locator('#leagueLookupResult')).toBeVisible();
  await expect(page.locator('#leagueLookupTitle')).toHaveText('Torneo RCY9EY');
  await expect(page.locator('#leagueLookupPublicId')).toContainText('RCY9EY');
  await expect(page.locator('#leagueLookupList li')).toHaveCount(3);
  await expect(page.locator('body')).not.toContainText(privateJoinCode);
  await expect(page.locator('#competeLeagueLink')).toBeHidden();
  await capture(page, 'public-league', isMobile, '#leagueLookupResult');
});

test('the owner sees locked progress and can save exactly three highlighted achievements', async ({ page, isMobile }) => {
  const selectedRequests = [];
  let currentProfile = honoursProfile();
  await page.addInitScript(() => {
    localStorage.setItem('minuto106:account-access-v1', 'a'.repeat(64));
  });
  await page.route('**/functions/v1/player-context', async (route) => {
    const body = bodyOf(route.request());
    expect(route.request().headers()['x-account-token']).toBe('a'.repeat(64));
    if (body.action === 'set-featured-achievements') {
      selectedRequests.push(body.achievementCodes);
      currentProfile = honoursProfile(body.achievementCodes, 2);
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ availability: 'owned', profile: currentProfile, leagues: [] }),
    });
  });

  await page.goto('/player/Owner/achievements');
  await expect(page.getByRole('heading', { name: 'Colección y progreso' })).toBeVisible();
  await expect(page.locator('#featuredAchievementsEditor')).toBeVisible();
  await expect(page.locator('#playerAchievements .honours-card.is-locked').first()).toBeVisible();
  await expect(page.locator('#playerAchievements')).toContainText('faltan 2');
  await expect(page.locator('#featuredAchievementCount')).toHaveText('1 de 3');

  await page.locator('[data-featured-code="verified_total_10"]').click();
  await page.locator('[data-featured-code="referral_total_1"]').click();
  await expect(page.locator('#featuredAchievementCount')).toHaveText('3 de 3');
  await expect(page.locator('[data-featured-code="duel_wins_1"]')).toBeDisabled();
  await page.locator('#saveFeaturedAchievements').click();

  await expect.poll(() => selectedRequests.length).toBe(1);
  expect(selectedRequests[0]).toEqual(['perfect_total_1', 'verified_total_10', 'referral_total_1']);
  await expect(page.locator('#playerAchievements .honours-card.is-featured')).toHaveCount(3);
  await expect(page.locator('#saveFeaturedAchievements')).toBeDisabled();
  await capture(page, 'player-honours-progress', isMobile, '#achievementsSection');
});
