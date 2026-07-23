import { createRequire } from 'node:module';

const runtimePath = process.env.PLAYWRIGHT_TEST_PATH;
if (!runtimePath) throw new Error('PLAYWRIGHT_TEST_PATH is required. Run Playwright through pnpm test:e2e.');
const require = createRequire(import.meta.url);
const { expect, test } = require(runtimePath);

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

function bodyOf(request) {
  try {
    return request.postDataJSON() || {};
  } catch {
    return {};
  }
}

async function installGameMocks(page, finishBodies) {
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
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ nick: body.nick || 'E2EPlayer', team: 'spain', history: [], attemptsUsed: 0, maxAttempts: 5, attemptsLeft: 5 }) });
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
          profile: { nick: 'E2EPlayer', attemptsUsed: 1, maxAttempts: 5, attemptsLeft: 4, history: [] },
        }),
      });
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
  for (const ball of balls) {
    await page.mouse.click(box.x + box.width * ball.x / 100, box.y + box.height * ball.y / 100);
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

async function prepareAttempt(page) {
  await page.goto('/');
  await page.locator('#nick').fill('E2EPlayer');
  await page.locator('[data-team="spain"]').click();
  await expect(page.locator('#startButton')).toBeEnabled();
  await page.locator('#startButton').click();
  await clickCaptcha(page);
  await expect(page.locator('.game-readiness-control')).toBeVisible();
  await expect(page.locator('#playInstruction')).toBeVisible();
  await expect(page.locator('.timer-hint')).toBeVisible();
  await clickDynamicControl(page, true);
  await expect(page.locator('.game-readiness-control')).toHaveAttribute('data-phase', 'countdown');
  await expect(page.locator('.game-readiness-control')).toHaveCount(0, { timeout: 6_000 });
}

test('the final control cannot finish before concealment and works after two seconds', async ({ page }) => {
  const finishes = [];
  await installGameMocks(page, finishes);
  await prepareAttempt(page);

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

test('delayed legacy ranking rows and stale award lookups stay complete across repeated races', async ({ page, isMobile }) => {
  let statsRequest = 0;
  await page.route('**/functions/v1/game-api', async (route) => {
    const body = bodyOf(route.request());
    if (body.action === 'stats') {
      statsRequest += 1;
      await new Promise((resolve) => setTimeout(resolve, statsRequest % 2 ? 120 : 15));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stats(statsRequest % 2 ? 'Delayed' : 'Fast', statsRequest % 2 ? 'spain' : 'argentina')) });
      return;
    }
    if (body.action === 'public-profile') {
      await new Promise((resolve) => setTimeout(resolve, body.nick === 'StaleAward' ? 180 : 5));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ nick: body.nick, team: body.nick === 'StaleAward' ? 'spain' : 'argentina' }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.goto('/');

  for (let iteration = 0; iteration < 8; iteration += 1) {
    await page.evaluate((index) => {
      document.querySelector('#leaderboard').innerHTML = `<li data-team="${index % 2 ? 'argentina' : 'spain'}"><span class="rank">#1</span><span class="player">Race${index}<small>${index % 2 ? 'Argentina' : 'España'} · 10.604 s</small></span><span class="difference">±4 ms</span></li>`;
    }, iteration);
    const list = page.locator('#leaderboard');
    await expect(list).toHaveAttribute('data-render-state', 'ready');
    await expect(list.locator('.leaderboard-row-link')).toHaveCount(1);
    await expect(list.locator('.ranking-time')).toHaveText('10.604s');
    await expect(list.locator('.ranking-flag')).toHaveAttribute('role', 'img');
  }

  await page.evaluate(() => {
    document.dispatchEvent(new CustomEvent('minuto106:attempt-finished', { detail: { stats: { awards: {
      goldenBoot: { nick: 'StaleAward', value: 4 },
      goldenGlove: { nick: 'StaleAward', value: 8 },
      goldenBall: { nick: 'StaleAward', value: 5 },
    } } } }));
    document.dispatchEvent(new CustomEvent('minuto106:attempt-finished', { detail: { stats: { awards: {
      goldenBoot: { nick: 'LatestAward', team: 'argentina', value: 3 },
      goldenGlove: { nick: 'LatestAward', team: 'argentina', value: 7 },
      goldenBall: { nick: 'LatestAward', team: 'argentina', value: 6 },
    } } } }));
  });
  await expect(page.locator('#goldenBoot')).toContainText('LatestAward');
  await expect(page.locator('#goldenBoot .award-flag')).toHaveClass(/flag--argentina/);
  await page.waitForTimeout(300);
  await expect(page.locator('#goldenBoot')).toContainText('LatestAward');
  await expect(page.locator('#goldenBoot .award-flag')).toHaveAttribute('aria-label', 'Argentina');

  if (!isMobile) await expect(page.locator('#leaderboard')).toBeVisible();
});
