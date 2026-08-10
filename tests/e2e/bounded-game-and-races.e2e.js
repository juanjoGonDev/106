import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const runtimePath = process.env.PLAYWRIGHT_TEST_PATH;
if (!runtimePath) throw new Error('PLAYWRIGHT_TEST_PATH is required. Run Playwright through pnpm test:e2e.');
const require = createRequire(import.meta.url);
const { expect, test } = require(runtimePath);
const previewDirectory = '.tmp/pr-previews';
mkdirSync(previewDirectory, { recursive: true });

const interaction = {
  mode: 'press',
  nonce: '550e8400-e29b-41d4-a716-446655440000',
  xPercent: 50,
  yPercent: 50,
  variant: 0,
};
const balls = [
  { order: 1, x: 20, y: 25, radius: 8 },
  { order: 2, x: 80, y: 25, radius: 8 },
  { order: 3, x: 20, y: 75, radius: 8 },
  { order: 4, x: 80, y: 75, radius: 8 },
];

function stats(nick = 'RaceWinner', team = 'spain') {
  return {
    totalAttempts: 30,
    totalPlayers: 8,
    verifiedAttempts: 28,
    perfectAttempts: 0,
    teams: [
      { team: 'spain', score: 292 },
      { team: 'argentina', score: 99 },
    ],
    leaderboard: [{ nick, team, elapsedMs: 10604, differenceMs: 4 }],
    awards: {
      goldenBoot: { nick, team, value: 4 },
      goldenGlove: { nick, team, value: 8 },
      goldenBall: { nick, team, value: 5 },
    },
  };
}

function profile(nick = 'E2EPlayer', attemptsLeft = 5) {
  return {
    nick,
    team: 'spain',
    history: [],
    attemptsUsed: 5 - attemptsLeft,
    verifiedAttempts: 5 - attemptsLeft,
    maxAttempts: 5,
    attemptsLeft,
    trophies: { total: 0, history: [] },
    achievements: { total: 0, points: 0, items: [] },
  };
}

function bodyOf(request) {
  try {
    return request.postDataJSON() || {};
  } catch {
    return {};
  }
}

async function installPlayerContextMock(page, response = {}) {
  await page.route('**/functions/v1/player-context', async (route) => {
    const body = bodyOf(route.request());
    const nick = body.nick || 'E2EPlayer';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        availability: 'owned',
        profile: profile(nick),
        leagues: [],
        ...response,
      }),
    });
  });
}

async function installGameMocks(page, finishBodies) {
  await installPlayerContextMock(page);
  await page.route('**/functions/v1/game-ready-api', async (route) => {
    const body = bodyOf(route.request());
    if (body.action === 'human-check') {
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ checkId: '11111111-1111-4111-8111-111111111111', balls, expiresAt: new Date(Date.now() + 120_000).toISOString() }) });
      return;
    }
    if (body.action === 'complete-human-check') {
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ checkId: body.checkId, proofToken: 'a'.repeat(64), expiresAt: new Date(Date.now() + 120_000).toISOString() }) });
      return;
    }
    if (body.action === 'prepare-start') {
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ prepared: true, challengeId: '22222222-2222-4222-8222-222222222222', readyExpiresAt: new Date(Date.now() + 120_000).toISOString(), interaction }) });
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
    if (body.action === 'stats') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stats()) });
      return;
    }
    if (body.action === 'profile' || body.action === 'public-profile' || body.action === 'nick-status') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(profile(body.nick || 'E2EPlayer')) });
      return;
    }
    if (body.action === 'access-status') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ exists: false }) });
      return;
    }
    if (body.action === 'finish') {
      finishBodies.push(body);
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          attempt: { nick: 'E2EPlayer', team: 'spain', elapsedMs: body.clientElapsedMs, differenceMs: Math.abs(10600 - body.clientElapsedMs), verified: true, competitionType: 'global' },
          attemptsLeft: 4,
          maxAttempts: 5,
          stats: stats('E2EPlayer', 'spain'),
          profile: profile('E2EPlayer', 4),
        }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

async function clickCaptcha(page) {
  const canvas = page.locator('.human-check-canvas');
  const progress = page.locator('.human-check-progress');
  await expect(canvas).toBeVisible({ timeout: 15_000 });
  await expect(progress).toHaveText('0 / 4', { timeout: 15_000 });

  for (const [index, ball] of balls.entries()) {
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Captcha canvas has no bounding box.');
    await page.mouse.click(box.x + box.width * ball.x / 100, box.y + box.height * ball.y / 100);
    if (index < balls.length - 1) {
      await expect(progress).toHaveText(`${index + 1} / 4`, { timeout: 5_000 });
    }
  }
}

async function dynamicControlBox(page, withinReadiness) {
  return page.evaluate((readiness) => {
    const root = readiness ? document.querySelector('.game-readiness-control') : document.querySelector('#playing');
    const host = [...(root?.querySelectorAll('*') || [])].find((element) => element.localName.startsWith('m106-'));
    if (!host) return null;
    const bounds = host.getBoundingClientRect();
    return { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height };
  }, withinReadiness);
}

async function clickDynamicControl(page, withinReadiness) {
  await expect.poll(() => dynamicControlBox(page, withinReadiness)).not.toBeNull();
  const box = await dynamicControlBox(page, withinReadiness);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function capturePlayingPanel(page, name, isMobile) {
  if (process.env.PR_VISUAL_CAPTURE !== '1') return;
  await page.locator('#playing').screenshot({
    path: `${previewDirectory}/${name}-${isMobile ? 'mobile' : 'desktop'}.png`,
    animations: 'disabled',
  });
}

async function prepareAttempt(page, { capture = false, isMobile = false } = {}) {
  await page.goto('/');
  await page.locator('#nick').fill('E2EPlayer');
  await page.getByRole('button', { name: 'España', exact: true }).click();
  await expect(page.locator('#startButton')).toBeEnabled();
  await page.locator('#startButton').click();
  await clickCaptcha(page);
  await expect(page.locator('.game-readiness-control')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#playInstruction')).toBeVisible();
  await expect(page.locator('.timer-hint')).toBeVisible();
  if (capture) await capturePlayingPanel(page, 'game-readiness', isMobile);
  await clickDynamicControl(page, true);
  await expect(page.locator('.game-readiness-control')).toHaveAttribute('data-phase', 'countdown');
  if (capture) await capturePlayingPanel(page, 'game-countdown', isMobile);
  await expect(page.locator('.game-readiness-control')).toHaveCount(0, { timeout: 6_000 });
}

test('the final control cannot finish before concealment and works after two seconds', async ({ page, isMobile }) => {
  const finishes = [];
  await installGameMocks(page, finishes);
  await prepareAttempt(page, { capture: true, isMobile });

  await clickDynamicControl(page, false);
  await page.waitForTimeout(250);
  expect(finishes).toHaveLength(0);

  await expect(page.locator('#timer')).toHaveClass(/concealed/, { timeout: 3_000 });
  await clickDynamicControl(page, false);
  await expect.poll(() => finishes.length).toBe(1);
  expect(finishes[0].clientElapsedMs).toBeGreaterThanOrEqual(2_000);
  expect(finishes[0].clientElapsedMs).toBeLessThan(30_000);
  expect(finishes[0].clientSignals.timerConcealed).toBe(true);
});

test('the 30-second deadline submits one exact automatic result', async ({ page }) => {
  const finishes = [];
  await page.addInitScript(() => {
    const nativeSetTimeout = window.setTimeout.bind(window);
    window.setTimeout = (callback, delay, ...args) => nativeSetTimeout(callback, delay === 30_000 ? 2_400 : delay, ...args);
  });
  await installGameMocks(page, finishes);
  await prepareAttempt(page);

  await expect.poll(() => finishes.length, { timeout: 5_000 }).toBe(1);
  await page.waitForTimeout(500);
  expect(finishes).toHaveLength(1);
  expect(finishes[0].clientElapsedMs).toBe(30_000);
  expect(finishes[0].clientSignals.pointerType).toBe('timeout');
  expect(finishes[0].clientSignals.finishEvent).toBe('timeout');
  expect(finishes[0].clientSignals.automaticFinish).toBe(true);
  expect(finishes[0].clientSignals.timerConcealed).toBe(true);
});

test('the authoritative snapshot updates ranking and awards without fallback requests', async ({ page }) => {
  let statsRequests = 0;
  let publicProfileRequests = 0;
  await installPlayerContextMock(page);
  await page.route('**/functions/v1/game-api', async (route) => {
    const body = bodyOf(route.request());
    if (body.action === 'stats') {
      statsRequests += 1;
      await new Promise((resolve) => setTimeout(resolve, 120));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stats('Initial', 'spain')) });
      return;
    }
    if (body.action === 'public-profile') publicProfileRequests += 1;
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.goto('/');
  const list = page.locator('#leaderboard');
  await expect(list).toHaveAttribute('data-render-state', 'ready');
  await expect(list.locator('.player-link__nick')).toHaveText('Initial');
  await expect(page.locator('#goldenBoot')).toContainText('Initial');
  expect(statsRequests).toBe(1);
  expect(publicProfileRequests).toBe(0);

  await page.evaluate(() => {
    window.Minuto106HomeStats.commit({
      totalAttempts: 31,
      totalPlayers: 9,
      verifiedAttempts: 29,
      perfectAttempts: 0,
      teams: [
        { team: 'spain', score: 292 },
        { team: 'argentina', score: 103 },
      ],
      leaderboard: [{ nick: 'Latest', team: 'argentina', elapsedMs: 10603, differenceMs: 3 }],
      awards: {
        goldenBoot: { nick: 'Latest', team: 'argentina', value: 3 },
        goldenGlove: { nick: 'Latest', team: 'argentina', value: 7 },
        goldenBall: { nick: 'Latest', team: 'argentina', value: 6 },
      },
    }, 'test');
  });

  await expect(list.locator('.player-link__nick')).toHaveText('Latest');
  await expect(list.locator('.ranking-flag')).toHaveAttribute('aria-label', 'Argentina');
  await expect(page.locator('#goldenBoot')).toContainText('Latest');
  await expect(page.locator('#goldenBoot .award-flag')).toHaveClass(/flag--argentina/);
  await page.waitForTimeout(300);
  expect(statsRequests).toBe(1);
  expect(publicProfileRequests).toBe(0);
});
