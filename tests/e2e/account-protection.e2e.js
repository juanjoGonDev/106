import { createRequire } from 'node:module';

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

async function installAccountApi(page, accounts, captured) {
  await page.route('**/functions/v1/player-context', async (route) => {
    const request = route.request();
    const body = bodyOf(request);
    const nick = String(body.nick || '');
    const token = request.headers()['x-account-token'] || '';
    const entry = accounts.nickToAccount.get(nick);
    const availability = !entry ? 'available' : entry === token ? 'owned' : 'occupied';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        availability,
        profile: entry ? playerProfile(nick) : null,
        leagues: availability === 'owned' ? [] : [],
      }),
    });
  });

  await page.route('**/functions/v1/game-api', async (route) => {
    const request = route.request();
    const body = bodyOf(request);
    const token = request.headers()['x-account-token'] || '';
    captured.push({ body, token });

    if (body.action === 'stats') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stats()) });
      return;
    }
    if (body.action === 'account-players') {
      const nicks = accounts.accountToNicks.get(token) || [];
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(nicks.map((nick) => ({ nick }))) });
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
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
      return;
    }
    if (body.action === 'start') {
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
          challengeId: '22222222-2222-4222-8222-222222222222',
          interaction: { mode: 'press', nonce: '550e8400-e29b-41d4-a716-446655440000', xPercent: 50, yPercent: 50, variant: 0 },
        }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

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
      const accountToken = route.request().headers()['x-account-token'] || '';
      const owner = accounts.nickToAccount.get(body.nick);
      if (owner && owner !== accountToken) {
        await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Este nick pertenece a otra cuenta.' }) });
        return;
      }
      accounts.nickToAccount.set(body.nick, accountToken);
      const current = accounts.accountToNicks.get(accountToken) || [];
      if (!current.includes(body.nick)) current.push(body.nick);
      accounts.accountToNicks.set(accountToken, current);
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
  const canvas = page.locator('.human-check-canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Captcha canvas has no bounding box.');
  for (const ball of balls) await page.mouse.click(box.x + box.width * ball.x / 100, box.y + box.height * ball.y / 100);
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
  await page.goto('/');

  await startWithNick(page, 'PrimaryPlayer');
  await expect.poll(() => accounts.nickToAccount.get('PrimaryPlayer')).toBeTruthy();
  const token = accounts.nickToAccount.get('PrimaryPlayer');
  expect(token).toMatch(/^[a-f0-9]{64}$/);

  await page.goto('/');
  await startWithNick(page, 'SecondPlayer');
  expect(accounts.nickToAccount.get('SecondPlayer')).toBe(token);

  await page.goto('/cuenta.html');
  await expect(page.locator('#accountPlayersList')).toContainText('PrimaryPlayer');
  await expect(page.locator('#accountPlayersList')).toContainText('SecondPlayer');
  await page.locator('#copyAccountKeyButton').click();
  const copied = await page.locator('#copyAccountKeyButton').getAttribute('data-copy-value');
  expect(copied).toBe(token);

  const restoredContext = await browser.newContext();
  const restoredPage = await restoredContext.newPage();
  await installAccountApi(restoredPage, accounts, captured);
  await restoredPage.goto('/cuenta.html');
  await restoredPage.locator('#accountKeyInput').fill(token);
  await restoredPage.getByRole('button', { name: 'Importar cuenta' }).click();
  await expect(restoredPage.locator('#accountPlayersList')).toContainText('PrimaryPlayer');
  await expect(restoredPage.locator('#accountPlayersList')).toContainText('SecondPlayer');

  await restoredContext.close();
  await context.close();
});

test('a different account learns that a protected nick is occupied before starting', async ({ browser }) => {
  const accounts = { nickToAccount: new Map(), accountToNicks: new Map() };
  const ownerCalls = [];
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await installAccountApi(ownerPage, accounts, ownerCalls);
  await ownerPage.goto('/');
  await startWithNick(ownerPage, 'ProtectedPlayer');
  const ownerToken = accounts.nickToAccount.get('ProtectedPlayer');

  const otherCalls = [];
  const otherContext = await browser.newContext();
  const otherPage = await otherContext.newPage();
  await installAccountApi(otherPage, accounts, otherCalls);
  await otherPage.goto('/');
  await otherPage.locator('#nick').fill('ProtectedPlayer');
  await otherPage.getByRole('button', { name: 'España', exact: true }).click();
  await expect(otherPage.locator('#nickStatus')).toContainText('ocupado');
  await expect(otherPage.locator('#startButton')).toBeDisabled();
  expect(otherCalls.some((entry) => entry.body.action === 'start')).toBe(false);
  expect(ownerToken).toMatch(/^[a-f0-9]{64}$/);

  await otherContext.close();
  await ownerContext.close();
});

test('the migration flow imports legacy nickname keys before removing the old local map', async ({ page }) => {
  const accounts = { nickToAccount: new Map(), accountToNicks: new Map() };
  const captured = [];
  const legacyKey = 'b'.repeat(64);
  await page.addInitScript(({ legacyKey }) => {
    localStorage.setItem('minuto106:player-access-v1', JSON.stringify({ legacyplayer: legacyKey }));
  }, { legacyKey });
  await installAccountApi(page, accounts, captured);
  await page.goto('/cuenta.html');
  await expect(page.locator('#migrationCard')).toBeVisible();
  await page.locator('#migrationAccountKey').fill('a'.repeat(64));
  await page.getByRole('button', { name: 'Migrar nicks' }).click();
  await expect.poll(() => captured.some((entry) => entry.body.action === 'link-account-player')).toBe(true);
  const link = captured.find((entry) => entry.body.action === 'link-account-player');
  expect(link.body.nick).toBe('legacyplayer');
  expect(link.token).toBe('a'.repeat(64));
  await expect(page.locator('#migrationCard')).toBeHidden();
});
