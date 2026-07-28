import { createRequire } from 'node:module';

import { openApplicationPage } from './app-navigation.js';

const runtimePath = process.env.PLAYWRIGHT_TEST_PATH;
if (!runtimePath) throw new Error('PLAYWRIGHT_TEST_PATH is required. Run Playwright through pnpm test:e2e.');
const require = createRequire(import.meta.url);
const { expect, test } = require(runtimePath);

const balls = [
  { order: 1, x: 20, y: 25, radius: 8 },
  { order: 2, x: 80, y: 25, radius: 8 },
  { order: 3, x: 20, y: 75, radius: 8 },
  { order: 4, x: 80, y: 75, radius: 8 },
];

function bodyOf(request) {
  try {
    return request.postDataJSON() || {};
  } catch {
    return {};
  }
}

function stats() {
  return {
    totalAttempts: 0,
    totalPlayers: 0,
    verifiedAttempts: 0,
    perfectAttempts: 0,
    teams: [{ team: 'spain', score: 0 }, { team: 'argentina', score: 0 }],
    leaderboard: [],
    awards: {},
  };
}

function playerProfile(nick) {
  return {
    nick,
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

function accountPlayers(accounts, token) {
  const nicks = accounts.accountToNicks.get(token) || [];
  return {
    exists: Boolean(token),
    players: nicks.map((nick) => ({
      nick,
      team: 'spain',
      attemptsUsed: 0,
      verifiedAttempts: 0,
      attemptsLeft: 5,
      bestDifferenceMs: null,
    })),
  };
}

async function installAccountApi(page, accounts, captured) {
  await page.route('**/functions/v1/player-context', async (route) => {
    const request = route.request();
    const body = bodyOf(request);
    const nick = String(body.nick || '');
    const token = request.headers()['x-account-token'] || '';
    const owner = accounts.nickToAccount.get(nick);
    const availability = !owner ? 'available' : owner === token ? 'owned' : 'occupied';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        availability,
        profile: owner ? playerProfile(nick) : null,
        leagues: [],
      }),
    });
  });

  await page.route('**/functions/v1/game-api', async (route) => {
    const request = route.request();
    const body = bodyOf(request);
    const token = request.headers()['x-account-token'] || '';
    const playerToken = request.headers()['x-player-token'] || '';
    captured.push({ body, token, playerToken });

    if (body.action === 'stats') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stats()) });
      return;
    }
    if (body.action === 'account-players') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(accountPlayers(accounts, token)) });
      return;
    }
    if (body.action === 'link-account-player') {
      const owner = accounts.nickToAccount.get(body.nick);
      if (owner && owner !== token) {
        await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Este nick pertenece a otra cuenta.' }) });
        return;
      }
      accounts.nickToAccount.set(body.nick, token);
      const current = accounts.accountToNicks.get(token) || [];
      if (!current.includes(body.nick)) current.push(body.nick);
      accounts.accountToNicks.set(token, current);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ authorized: true, linked: true }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.route('**/functions/v1/game-ready-api', async (route) => {
    const request = route.request();
    const body = bodyOf(request);
    if (body.action === 'human-check') {
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ checkId: '11111111-1111-4111-8111-111111111111', balls, expiresAt: new Date(Date.now() + 120_000).toISOString() }) });
      return;
    }
    if (body.action === 'complete-human-check') {
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ checkId: body.checkId, proofToken: 'a'.repeat(64), expiresAt: new Date(Date.now() + 120_000).toISOString() }) });
      return;
    }
    if (body.action === 'prepare-start') {
      const token = request.headers()['x-account-token'] || '';
      const owner = accounts.nickToAccount.get(body.nick);
      if (owner && owner !== token) {
        await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Este nick pertenece a otra cuenta.' }) });
        return;
      }
      accounts.nickToAccount.set(body.nick, token);
      const current = accounts.accountToNicks.get(token) || [];
      if (!current.includes(body.nick)) current.push(body.nick);
      accounts.accountToNicks.set(token, current);
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
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

async function clickCaptcha(page) {
  const overlay = page.locator('.human-check-overlay');
  const canvas = page.locator('.human-check-canvas');
  const progress = page.locator('.human-check-progress');
  await expect(overlay).toHaveAttribute('data-phase', 'solving');
  await expect(progress).toHaveText(`0 / ${balls.length}`);
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Captcha canvas has no bounding box.');

  for (const [index, ball] of balls.entries()) {
    await page.mouse.click(box.x + box.width * ball.x / 100, box.y + box.height * ball.y / 100);
    if (index < balls.length - 1) {
      await expect(progress).toHaveText(`${index + 1} / ${balls.length}`);
    }
  }
}

async function startWithNick(page, nick) {
  await page.locator('#nick').fill(nick);
  await page.getByRole('button', { name: 'España', exact: true }).click();
  await expect(page.locator('#startButton')).toBeEnabled();
  await page.locator('#startButton').click();
  await clickCaptcha(page);
  await expect(page.locator('.game-readiness-control')).toBeVisible();
}

test('one account key protects multiple nicks and can be restored on a fresh device', async ({ browser }) => {
  const accounts = { nickToAccount: new Map(), accountToNicks: new Map() };
  const captured = [];
  const context = await browser.newContext();
  const page = await context.newPage();
  await installAccountApi(page, accounts, captured);
  await openApplicationPage(page, '/');

  await startWithNick(page, 'PrimaryPlayer');
  await expect.poll(() => accounts.nickToAccount.get('PrimaryPlayer')).toBeTruthy();
  const token = accounts.nickToAccount.get('PrimaryPlayer');
  expect(token).toMatch(/^[a-f0-9]{64}$/);

  await openApplicationPage(page, '/');
  await startWithNick(page, 'SecondPlayer');
  expect(accounts.nickToAccount.get('SecondPlayer')).toBe(token);

  await openApplicationPage(page, '/cuenta.html');
  await expect(page.locator('#accountPlayers')).toContainText('PrimaryPlayer');
  await expect(page.locator('#accountPlayers')).toContainText('SecondPlayer');
  await page.locator('#showAccountKey').click();
  await expect(page.locator('#accountKeyPreview')).toHaveText(token);

  const restoredContext = await browser.newContext();
  const restoredPage = await restoredContext.newPage();
  await installAccountApi(restoredPage, accounts, captured);
  await openApplicationPage(restoredPage, '/cuenta.html');
  await restoredPage.locator('#importAccountKey').fill(token);
  await restoredPage.locator('#importAccountButton').click();
  await expect(restoredPage.locator('#accountPlayers')).toContainText('PrimaryPlayer');
  await expect(restoredPage.locator('#accountPlayers')).toContainText('SecondPlayer');

  await restoredContext.close();
  await context.close();
});

test('a different account learns that a protected nick is occupied before starting', async ({ browser }) => {
  const accounts = { nickToAccount: new Map(), accountToNicks: new Map() };
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await installAccountApi(ownerPage, accounts, []);
  await openApplicationPage(ownerPage, '/');
  await startWithNick(ownerPage, 'ProtectedPlayer');
  const ownerToken = accounts.nickToAccount.get('ProtectedPlayer');

  const otherCalls = [];
  const otherContext = await browser.newContext();
  const otherPage = await otherContext.newPage();
  await installAccountApi(otherPage, accounts, otherCalls);
  await openApplicationPage(otherPage, '/');
  await otherPage.locator('#nick').fill('ProtectedPlayer');
  await otherPage.getByRole('button', { name: 'España', exact: true }).click();
  await expect(otherPage.locator('#nickStatus')).toContainText('ocupado');
  await expect(otherPage.locator('#startButton')).toBeDisabled();
  expect(otherCalls.some((entry) => entry.body.action === 'start' || entry.body.action === 'prepare-start')).toBe(false);
  expect(ownerToken).toMatch(/^[a-f0-9]{64}$/);

  await otherContext.close();
  await ownerContext.close();
});

test('legacy nickname keys are linked once and removed after a successful migration', async ({ page }) => {
  const accounts = { nickToAccount: new Map(), accountToNicks: new Map() };
  const captured = [];
  const legacyKey = 'b'.repeat(64);
  const accountToken = 'a'.repeat(64);
  await page.addInitScript(({ legacyKey: storedLegacyKey, accountToken: storedAccountToken }) => {
    localStorage.setItem('minuto106:player-access-v1', JSON.stringify({ legacyplayer: storedLegacyKey }));
    localStorage.setItem('minuto106:account-access-v1', storedAccountToken);
  }, { legacyKey, accountToken });
  await installAccountApi(page, accounts, captured);
  await openApplicationPage(page, '/cuenta.html');

  await expect.poll(() => captured.some((entry) => entry.body.action === 'link-account-player')).toBe(true);
  const link = captured.find((entry) => entry.body.action === 'link-account-player');
  expect(link.body.nick).toBe('legacyplayer');
  expect(link.token).toBe(accountToken);
  expect(link.playerToken).toBe(legacyKey);
  await expect(page.locator('#accountPlayers')).toContainText('legacyplayer');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('minuto106:player-access-v1'))).toBeNull();
});
