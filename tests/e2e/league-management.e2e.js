import { createRequire } from 'node:module';

const runtimePath = process.env.PLAYWRIGHT_TEST_PATH;
if (!runtimePath) throw new Error('PLAYWRIGHT_TEST_PATH is required. Run Playwright through pnpm test:e2e.');
const require = createRequire(import.meta.url);
const { expect, test } = require(runtimePath);

const readyBalls = [
  { order: 1, x: 20, y: 25, radius: 8 },
  { order: 2, x: 80, y: 25, radius: 8 },
  { order: 3, x: 20, y: 75, radius: 8 },
  { order: 4, x: 80, y: 75, radius: 8 },
];
const leagues = [
  {
    publicId: 'WAIT01',
    competitionCode: 'WAIT01',
    joinCode: 'JOIN01',
    name: 'Liga en espera',
    ownerNick: 'LeagueOwner',
    isOwner: true,
    createdAt: '2026-07-24T10:00:00.000Z',
    startsAt: null,
    endsAt: null,
    waiting: true,
    active: false,
    finished: false,
    eligibleOwners: 2,
    eligibleDevices: 2,
    participants: 2,
    attemptsUsed: 0,
    attemptsLeft: 5,
    maxAttempts: 5,
    history: [],
  },
  {
    publicId: 'ACTIVE1',
    competitionCode: 'ACTIVE1',
    joinCode: 'JOIN02',
    name: 'Liga activa',
    ownerNick: 'LeagueOwner',
    isOwner: true,
    createdAt: '2026-07-23T10:00:00.000Z',
    startsAt: '2026-07-23T12:00:00.000Z',
    endsAt: '2026-07-26T12:00:00.000Z',
    waiting: false,
    active: true,
    finished: false,
    eligibleOwners: 3,
    eligibleDevices: 3,
    participants: 3,
    attemptsUsed: 2,
    attemptsLeft: 3,
    maxAttempts: 5,
    bestDifferenceMs: 22,
    rank: 2,
    history: [
      { id: 'history-1', team: 'spain', elapsedMs: 10622, differenceMs: 22, verified: true, createdAt: '2026-07-23T12:10:00.000Z' },
      { id: 'history-2', team: 'argentina', elapsedMs: 10540, differenceMs: 60, verified: true, createdAt: '2026-07-23T12:05:00.000Z' },
    ],
  },
];

function bodyOf(request) {
  try {
    return request.postDataJSON() || {};
  } catch {
    return {};
  }
}

function publicLeague(publicId) {
  const membership = leagues.find((league) => league.publicId === publicId) || leagues[0];
  return {
    publicId: membership.publicId,
    code: membership.publicId,
    name: membership.name,
    waiting: membership.waiting,
    active: membership.active,
    finished: membership.finished,
    startsAt: membership.startsAt,
    endsAt: membership.endsAt,
    members: membership.participants,
    participantCount: membership.participants,
    eligibleOwners: membership.eligibleOwners,
    eligibleDevices: membership.eligibleDevices,
    totalAttempts: membership.attemptsUsed,
    revision: 1784886488107,
    leaderboard: membership.active ? [
      { nick: 'LeagueRival', rank: 1, attemptsUsed: 3, verifiedAttempts: 3, bestDifferenceMs: 12 },
      { nick: 'LeagueOwner', rank: 2, attemptsUsed: 2, verifiedAttempts: 2, bestDifferenceMs: 22 },
    ] : [],
  };
}

function playerProfile() {
  return {
    nick: 'LeagueOwner',
    team: 'spain',
    attemptsUsed: 0,
    attemptsLeft: 5,
    maxAttempts: 5,
    verifiedAttempts: 0,
    history: [],
    trophies: { total: 0, history: [] },
    achievements: { total: 0, points: 0, items: [] },
  };
}

async function clickCaptcha(page) {
  const canvas = page.locator('.human-check-canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Captcha canvas has no bounding box.');
  for (const ball of readyBalls) {
    await page.mouse.click(box.x + box.width * ball.x / 100, box.y + box.height * ball.y / 100);
  }
}

test('the league page lists all memberships and switches the selected public league', async ({ page }) => {
  const requests = [];
  await page.addInitScript(() => localStorage.setItem('minuto106:nick', 'LeagueOwner'));
  await page.route('**/functions/v1/game-api', async (route) => {
    const body = bodyOf(route.request());
    requests.push(body);
    if (body.action === 'player-leagues') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(leagues) });
      return;
    }
    if (body.action === 'league') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(publicLeague(body.code)) });
      return;
    }
    if (body.action === 'league-status') {
      const membership = leagues.find((league) => league.publicId === body.code) || leagues[0];
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...membership, member: true }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.goto('/ligas.html');
  await expect(page.locator('[data-league-card]')).toHaveCount(2);
  await expect(page.locator('[data-league-card="WAIT01"]')).toContainText('espera');
  await expect(page.locator('[data-league-card="ACTIVE1"]')).toContainText('Liga activa');
  await expect(page.locator('[data-league-card="ACTIVE1"]')).toContainText('2/5');
  await expect(page.locator('[data-league-card="ACTIVE1"] a.primary')).toHaveAttribute('href', './?competition=ACTIVE1');
  await expect(page.locator('[data-league-card="WAIT01"] a.primary')).toHaveCount(0);

  await page.locator('[data-view-league="WAIT01"]').click();
  await expect(page).toHaveURL(/\/ligas\/WAIT01$/);
  await expect(page.locator('#leagueLookupPublicId')).toContainText('WAIT01');
  await expect(page.locator('#competeLeagueLink')).toBeHidden();

  await page.locator('[data-view-league="ACTIVE1"]').click();
  await expect(page).toHaveURL(/\/ligas\/ACTIVE1$/);
  await expect(page.locator('#leagueLookupTitle')).toHaveText('Liga activa');
  await expect(page.locator('#competeLeagueLink')).toBeVisible();
  await expect(page.locator('#myLeagueAttempts')).toBeVisible();
  await expect(page.locator('#myLeagueAttemptList li')).toHaveCount(2);
  expect(requests.filter((request) => request.action === 'player-leagues')).toHaveLength(1);
});

test('the active league route selects that competition and sends its public scope to the server', async ({ page }) => {
  const requestLog = [];
  await page.addInitScript(() => localStorage.setItem('minuto106:nick', 'LeagueOwner'));
  await page.route('**/functions/v1/player-context', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ availability: 'owned', profile: playerProfile(), leagues: [leagues[1]] }),
    });
  });
  await page.route('**/functions/v1/game-ready-api', async (route) => {
    const body = bodyOf(route.request());
    if (body.action === 'human-check') {
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ checkId: '11111111-1111-4111-8111-111111111111', balls: readyBalls, expiresAt: new Date(Date.now() + 120_000).toISOString() }) });
      return;
    }
    if (body.action === 'complete-human-check') {
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ checkId: body.checkId, proofToken: 'a'.repeat(64), expiresAt: new Date(Date.now() + 120_000).toISOString() }) });
      return;
    }
    if (body.action === 'prepare-start') {
      requestLog.push(body);
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          prepared: true,
          challengeId: '22222222-2222-4222-8222-222222222222',
          readyExpiresAt: new Date(Date.now() + 120_000).toISOString(),
          interaction: { mode: 'press', nonce: '550e8400-e29b-41d4-a716-446655440000', xPercent: 50, yPercent: 50, variant: 0 },
        }),
      });
      return;
    }
    if (body.action === 'activate-start') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ startsAt: new Date(Date.now() + 3_000).toISOString() }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.route('**/functions/v1/game-api', async (route) => {
    const body = bodyOf(route.request());
    requestLog.push(body);
    if (body.action === 'stats') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          totalAttempts: 0,
          totalPlayers: 0,
          verifiedAttempts: 0,
          perfectAttempts: 0,
          teams: [{ team: 'spain', score: 0 }, { team: 'argentina', score: 0 }],
          leaderboard: [],
          awards: {},
        }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.goto('/?competition=ACTIVE1');
  await expect(page.locator('#competitionContext')).toBeVisible();
  await expect(page.locator('#competitionContext')).toContainText('Liga activa');
  await expect(page.locator('#competitionPicker')).toHaveValue('league:ACTIVE1');
  await page.getByRole('button', { name: 'España', exact: true }).click();
  await expect(page.locator('#startButton')).toBeEnabled();
  await page.locator('#startButton').click();
  await clickCaptcha(page);
  await expect(page.locator('.game-readiness-control')).toBeVisible();
  const preparedRequest = requestLog.find((request) => request.action === 'prepare-start');
  expect(preparedRequest?.leagueCode).toBe('ACTIVE1');
  expect(requestLog.some((request) => request.action === 'player-leagues')).toBe(false);
});
