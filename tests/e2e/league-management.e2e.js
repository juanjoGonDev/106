import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const runtimePath = process.env.PLAYWRIGHT_TEST_PATH;
if (!runtimePath) throw new Error('PLAYWRIGHT_TEST_PATH is required. Run Playwright through pnpm test:e2e.');
const require = createRequire(import.meta.url);
const { devices, expect, test } = require(runtimePath);
const previewDirectory = '.tmp/pr-previews';
const captureEvidence = process.env.PR_VISUAL_CAPTURE === '1';
const applicationUrl = 'http://127.0.0.1:3000';
const storedConsent = JSON.stringify({ analytics: false, ads: false, updatedAt: '2026-07-26T00:00:00.000Z' });
mkdirSync(previewDirectory, { recursive: true });

const readyBalls = [
  { order: 1, x: 20, y: 25, radius: 8 },
  { order: 2, x: 80, y: 25, radius: 8 },
  { order: 3, x: 20, y: 75, radius: 8 },
  { order: 4, x: 80, y: 75, radius: 8 },
];

function isoAfter(milliseconds) {
  return new Date(Date.now() + milliseconds).toISOString();
}

function fixtures() {
  return [
    {
      publicId: 'PUBLIC', name: 'Copa pública', visibility: 'public', locked: false,
      participantCount: 2, members: 2, requiredParticipants: 3, maxParticipants: 10, durationDays: 3,
      waiting: true, scheduled: false, active: false, finished: false, startsAt: null, endsAt: null,
      totalAttempts: 0, revision: 1, leaderboard: [],
    },
    {
      publicId: 'PRIV01', name: 'Liga privada', visibility: 'private', locked: true,
      participantCount: 1, members: 1, requiredParticipants: 3, maxParticipants: 20, durationDays: 5,
      waiting: true, scheduled: false, active: false, finished: false, startsAt: null, endsAt: null,
      totalAttempts: 0, revision: 2, leaderboard: [],
    },
    {
      publicId: 'SCHED1', name: 'Liga programada', visibility: 'public', locked: false,
      participantCount: 3, members: 3, requiredParticipants: 3, maxParticipants: 30, durationDays: 7,
      waiting: false, scheduled: true, active: false, finished: false,
      startsAt: isoAfter(23 * 3_600_000), endsAt: isoAfter((23 + 7 * 24) * 3_600_000),
      totalAttempts: 0, revision: 3, leaderboard: [],
    },
    {
      publicId: 'ACTIVE1', competitionCode: 'ACTIVE1', joinCode: 'JOIN02', name: 'Liga activa',
      visibility: 'private', locked: true, ownerNick: 'LeagueOwner', isOwner: true,
      participantCount: 3, members: 3, requiredParticipants: 3, maxParticipants: 10, durationDays: 2,
      waiting: false, scheduled: false, active: true, finished: false,
      startsAt: isoAfter(-3_600_000), endsAt: isoAfter(47 * 3_600_000),
      totalAttempts: 5, attemptsUsed: 2, attemptsLeft: 3, maxAttempts: 5,
      bestDifferenceMs: 22, rank: 2, revision: 4,
      history: [
        { id: 'history-1', team: 'spain', elapsedMs: 10622, differenceMs: 22, verified: true, createdAt: isoAfter(-1_000) },
        { id: 'history-2', team: 'argentina', elapsedMs: 10540, differenceMs: 60, verified: true, createdAt: isoAfter(-2_000) },
      ],
      leaderboard: [
        { nick: 'LeagueRival', rank: 1, attemptsUsed: 3, verifiedAttempts: 3, bestDifferenceMs: 12 },
        { nick: 'LeagueOwner', rank: 2, attemptsUsed: 2, verifiedAttempts: 2, bestDifferenceMs: 22 },
      ],
    },
  ];
}

function bodyOf(request) {
  try {
    return request.postDataJSON() || {};
  } catch {
    return {};
  }
}

function playerProfile() {
  return {
    nick: 'LeagueOwner', team: 'spain', attemptsUsed: 0, attemptsLeft: 5, maxAttempts: 5,
    verifiedAttempts: 0, history: [], trophies: { total: 0, history: [] },
    achievements: { total: 0, points: 0, items: [] },
  };
}

function stats() {
  return {
    targetMs: 10600, totalAttempts: 0, totalPlayers: 0, verifiedAttempts: 0, perfectAttempts: 0,
    teams: [{ team: 'spain', score: 0 }, { team: 'argentina', score: 0 }],
    leaderboard: [], awards: {}, honoursRankings: { trophies: [], achievements: [] },
  };
}

async function installLeagueApiMock(page, requestLog = []) {
  await page.route('**/functions/v1/league-api', async (route) => {
    const body = bodyOf(route.request());
    requestLog.push(body);
    const leagues = fixtures();
    if (body.action === 'list-leagues') {
      const search = String(body.search || '').toLocaleLowerCase('es');
      const listed = leagues.filter((league) => (
        (body.visibility === 'all' || body.visibility === league.visibility)
        && (!search || league.name.toLocaleLowerCase('es').includes(search) || league.publicId.toLocaleLowerCase('es').includes(search))
      ));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(listed) });
      return;
    }
    if (body.action === 'player-leagues') {
      const owned = body.nick === 'LeagueOwner' ? [leagues.find((league) => league.publicId === 'ACTIVE1')] : [];
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(owned) });
      return;
    }
    if (body.action === 'league') {
      const league = leagues.find((entry) => entry.publicId === body.publicId);
      await route.fulfill({ status: league ? 200 : 404, contentType: 'application/json', body: JSON.stringify(league || { error: 'No existe' }) });
      return;
    }
    if (body.action === 'league-status') {
      const league = leagues.find((entry) => entry.publicId === body.publicId);
      await route.fulfill({ status: league ? 200 : 404, contentType: 'application/json', body: JSON.stringify(league ? { ...league, member: true } : { error: 'No existe' }) });
      return;
    }
    if (body.action === 'join-league') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ publicId: body.publicId || 'PRIV01' }) });
      return;
    }
    if (body.action === 'create-league') {
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ publicId: 'NEW001' }) });
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Unknown action' }) });
  });
}

async function installHomeApiMocks(page, requestLog = []) {
  const active = fixtures().find((league) => league.publicId === 'ACTIVE1');
  await page.route('**/functions/v1/player-context', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ availability: 'owned', profile: playerProfile(), leagues: [active] }) });
  });
  await page.route('**/functions/v1/game-api', async (route) => {
    const body = bodyOf(route.request());
    requestLog.push(body);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body.action === 'stats' ? stats() : {}) });
  });
  await page.route('**/functions/v1/game-ready-api', async (route) => {
    const body = bodyOf(route.request());
    requestLog.push(body);
    if (body.action === 'human-check') {
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ checkId: '11111111-1111-4111-8111-111111111111', balls: readyBalls, expiresAt: isoAfter(120_000) }) });
      return;
    }
    if (body.action === 'complete-human-check') {
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ checkId: body.checkId, proofToken: 'a'.repeat(64), expiresAt: isoAfter(120_000) }) });
      return;
    }
    if (body.action === 'prepare-start') {
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ prepared: true, challengeId: '22222222-2222-4222-8222-222222222222', readyExpiresAt: isoAfter(120_000), interaction: { mode: 'press', nonce: '550e8400-e29b-41d4-a716-446655440000', xPercent: 50, yPercent: 50, variant: 0 } }) });
      return;
    }
    if (body.action === 'activate-start') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ startsAt: isoAfter(3_000) }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
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

function evidenceName(area, isMobile) {
  return `${area}-${isMobile ? 'mobile' : 'desktop'}`;
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
    storageState: {
      cookies: [],
      origins: [{
        origin: applicationUrl,
        localStorage: [
          { name: 'minuto106:consent-v1', value: storedConsent },
          { name: 'minuto106:nick', value: 'LeagueOwner' },
        ],
      }],
    },
  };
}

async function saveScreenshot(page, area, isMobile) {
  if (!captureEvidence) return;
  await page.screenshot({ path: join(previewDirectory, `${evidenceName(area, isMobile)}.png`), animations: 'disabled' });
}

async function saveVideo(context, page, area, isMobile) {
  const video = page.video();
  if (!video) throw new Error(`Playwright did not create the ${area} recording.`);
  await context.close();
  await video.saveAs(join(previewDirectory, `${evidenceName(area, isMobile)}.webm`));
}

test('lists searchable public and private leagues and joins a public one without a private code', async ({ page, isMobile }) => {
  const requests = [];
  await page.addInitScript(() => localStorage.setItem('minuto106:nick', 'LeagueOwner'));
  await installLeagueApiMock(page, requests);
  await page.goto('/ligas.html');

  await expect(page.locator('[data-directory-league]')).toHaveCount(4);
  await expect(page.locator('[data-directory-league="PRIV01"] .league-access-badge')).toContainText('Privada');
  await expect(page.locator('[data-directory-league="PRIV01"] [data-join-public]')).toHaveCount(0);
  await expect(page.locator('[data-directory-league="PUBLIC"] [data-join-public]')).toBeVisible();

  await page.locator('#leagueVisibilityFilter').selectOption('public');
  await expect(page.locator('[data-directory-league]')).toHaveCount(3);
  await page.locator('#leagueSearch').fill('programada');
  await expect(page.locator('[data-directory-league]')).toHaveCount(1);
  await expect(page.locator('[data-directory-league="SCHED1"]')).toBeVisible();

  await page.locator('#leagueSearch').fill('');
  await expect(page.locator('[data-directory-league="PUBLIC"]')).toBeVisible();
  await saveScreenshot(page, 'league-directory', isMobile);

  await page.locator('[data-directory-league="PUBLIC"] [data-join-public]').click();
  await expect(page).toHaveURL(/\/ligas\/PUBLIC$/);
  expect(requests.find((request) => request.action === 'join-league')).toMatchObject({ publicId: 'PUBLIC', nick: 'LeagueOwner' });
  expect(requests.filter((request) => request.action === 'list-leagues').at(-1)).toMatchObject({ visibility: 'public', search: '' });
});

test('dedicated active league route hides the hub and opens the home with the league preselected', async ({ page, isMobile }) => {
  await page.addInitScript(() => localStorage.setItem('minuto106:nick', 'LeagueOwner'));
  await installLeagueApiMock(page);
  await installHomeApiMocks(page);
  await page.goto('/ligas/ACTIVE1');

  await expect(page.locator('.league-directory-only').first()).toBeHidden();
  await expect(page.locator('#leagueLookupTitle')).toHaveText('Liga activa');
  await expect(page.locator('#leagueLookupConfig')).toContainText('3/10 participantes');
  await expect(page.locator('#competeLeagueLink')).toBeVisible();
  await expect(page.locator('#joinPublicLeagueButton')).toBeHidden();
  await expect(page.locator('#myLeagueAttemptList li')).toHaveCount(2);
  await saveScreenshot(page, 'league-detail-active', isMobile);

  await page.locator('#competeLeagueLink').click();
  await expect(page).toHaveURL(/\?competition=ACTIVE1$/);
  await expect(page.locator('#competitionPicker')).toHaveValue('league:ACTIVE1');
  await expect(page.locator('#competitionContext')).toContainText('Liga activa');
});

test('dedicated scheduled league shows the 23-hour countdown and blocks play until the start', async ({ page, isMobile }) => {
  await installLeagueApiMock(page);
  await page.goto('/ligas/SCHED1');

  await expect(page.locator('.league-directory-only').first()).toBeHidden();
  await expect(page.locator('#leagueLookupTitle')).toHaveText('Liga programada');
  await expect(page.locator('#leagueLookupEnds')).toContainText('Empieza en');
  await expect(page.locator('#leagueMembershipMessage')).toContainText('Inicio programado');
  await expect(page.locator('#leagueLookupConfig')).toContainText('7 días');
  await expect(page.locator('#leagueLookupConfig')).toContainText('3/30 participantes');
  await expect(page.locator('#competeLeagueLink')).toBeHidden();
  await expect(page.locator('#joinPublicLeagueButton')).toBeVisible();
  await expect(page.locator('#leagueDetailNickRow')).toBeVisible();
  await saveScreenshot(page, 'league-detail-scheduled', isMobile);
});

test('the active league selection sends its public scope to the prepared attempt API', async ({ page }) => {
  const requestLog = [];
  await page.addInitScript(() => localStorage.setItem('minuto106:nick', 'LeagueOwner'));
  await installHomeApiMocks(page, requestLog);
  await page.goto('/?competition=ACTIVE1');
  await expect(page.locator('#competitionPicker')).toHaveValue('league:ACTIVE1');
  await page.getByRole('button', { name: 'España', exact: true }).click();
  await expect(page.locator('#startButton')).toBeEnabled();
  await page.locator('#startButton').click();
  await clickCaptcha(page);
  await expect(page.locator('.game-readiness-control')).toBeVisible();
  expect(requestLog.find((request) => request.action === 'prepare-start')?.leagueCode).toBe('ACTIVE1');
});

test('records the complete searchable league directory interaction', async ({ browser, isMobile }) => {
  test.skip(!captureEvidence, 'Visual recording is generated only by the PR evidence workflow.');
  const context = await browser.newContext(recordingContextOptions(isMobile));
  const page = await context.newPage();
  await installLeagueApiMock(page);
  await page.goto('/ligas.html');
  await expect(page.locator('[data-directory-league]')).toHaveCount(4);
  await page.waitForTimeout(500);
  await page.locator('#leagueVisibilityFilter').selectOption('private');
  await expect(page.locator('[data-directory-league]')).toHaveCount(1);
  await page.waitForTimeout(600);
  await page.locator('#leagueVisibilityFilter').selectOption('public');
  await page.locator('#leagueSearch').fill('programada');
  await expect(page.locator('[data-directory-league="SCHED1"]')).toBeVisible();
  await page.waitForTimeout(900);
  await saveVideo(context, page, 'league-directory', isMobile);
});

test('records the active league play hand-off to the preselected home competition', async ({ browser, isMobile }) => {
  test.skip(!captureEvidence, 'Visual recording is generated only by the PR evidence workflow.');
  const context = await browser.newContext(recordingContextOptions(isMobile));
  const page = await context.newPage();
  await installLeagueApiMock(page);
  await installHomeApiMocks(page);
  await page.goto('/ligas/ACTIVE1');
  await expect(page.locator('#competeLeagueLink')).toBeVisible();
  await page.waitForTimeout(700);
  await page.locator('#competeLeagueLink').click();
  await expect(page.locator('#competitionPicker')).toHaveValue('league:ACTIVE1');
  await page.waitForTimeout(1_000);
  await saveVideo(context, page, 'league-detail-active', isMobile);
});

test('records the scheduled league countdown without exposing the play action', async ({ browser, isMobile }) => {
  test.skip(!captureEvidence, 'Visual recording is generated only by the PR evidence workflow.');
  const context = await browser.newContext(recordingContextOptions(isMobile));
  const page = await context.newPage();
  await installLeagueApiMock(page);
  await page.goto('/ligas/SCHED1');
  await expect(page.locator('#leagueLookupEnds')).toContainText('Empieza en');
  await expect(page.locator('#competeLeagueLink')).toBeHidden();
  await page.waitForTimeout(2_500);
  await saveVideo(context, page, 'league-detail-scheduled', isMobile);
});
