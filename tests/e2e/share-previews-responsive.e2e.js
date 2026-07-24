import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const runtimePath = process.env.PLAYWRIGHT_TEST_PATH;
if (!runtimePath) throw new Error('PLAYWRIGHT_TEST_PATH is required. Run Playwright through pnpm test:e2e.');
const require = createRequire(import.meta.url);
const { expect, test } = require(runtimePath);

const visualCapture = process.env.PR_VISUAL_CAPTURE === '1';
const previewRoot = resolve('.tmp/pr-previews');
const apiBaseUrl = 'https://imtitjwgiemlaabpioed.supabase.co/functions/v1/game-api';
const duelCode = '11111111-2222-4333-8444-555555555555';
const resultId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

function requestBody(request) {
  try {
    return request.postDataJSON() || {};
  } catch {
    return {};
  }
}

function profile(nick = 'VIEUCIRST') {
  return {
    nick,
    profileRevision: 123,
    referralCode: '99999999-8888-4777-8666-555555555555',
    attemptsUsed: 1,
    attemptsLeft: 4,
    maxAttempts: 5,
    verifiedAttempts: 1,
    bestDifferenceMs: 4,
    averageDifferenceMs: 4,
    globalRankBest: 1,
    totalPlayers: 10,
    trophies: { total: 2, history: [] },
    achievements: { total: 3, points: 30, items: [] },
    history: [{ id: resultId, team: 'spain', elapsedMs: 10604, differenceMs: 4, verified: true, createdAt: '2026-07-24T12:00:00Z' }],
  };
}

function stats() {
  return {
    targetMs: 10600,
    totalAttempts: 1,
    verifiedAttempts: 1,
    totalPlayers: 1,
    perfectAttempts: 0,
    teams: [{ team: 'spain', score: 96 }, { team: 'argentina', score: 0 }],
    leaderboard: [{ id: resultId, nick: 'VIEUCIRST', team: 'spain', elapsedMs: 10604, differenceMs: 4 }],
    awards: {},
    honoursRankings: { trophies: [], achievements: [] },
  };
}

async function installCommonMocks(page) {
  await page.addInitScript(() => {
    localStorage.setItem('minuto106:nick', 'VIEUCIRST');
    localStorage.setItem('minuto106:device-id', 'responsive-e2e-device-106');
    localStorage.setItem('minuto106:account-access-v1', 'a'.repeat(64));
    Object.defineProperty(globalThis.navigator, 'share', {
      configurable: true,
      value: async (payload) => {
        globalThis.__sharePayload = payload;
      },
    });
  });

  await page.route('**/config.js*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `window.__MINUTO106_CONFIG__ = ${JSON.stringify({ apiBaseUrl })};`,
    });
  });

  await page.route('**/functions/v1/game-api', async (route) => {
    const body = requestBody(route.request());
    if (body.action === 'stats') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stats()) });
      return;
    }
    if (['profile', 'public-profile', 'nick-status'].includes(body.action)) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(profile(body.nick || 'VIEUCIRST')) });
      return;
    }
    if (body.action === 'account-players') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          players: [
            { nick: 'VIEUCIRST', team: 'spain', bestDifferenceMs: 4, attemptsLeft: 4 },
            { nick: 'JugadorConNombreLargo24', team: 'argentina', bestDifferenceMs: 125, attemptsLeft: 2 },
          ],
        }),
      });
      return;
    }
    if (body.action === 'create-duel') {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ code: duelCode, targetElapsedMs: 10604, targetDifferenceMs: 4, expiresAt: '2026-07-27T12:00:00Z' }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.route('**/functions/v1/social-share/duel/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        code: duelCode,
        challengerNick: 'VIEUCIRST',
        challengerTeam: 'spain',
        targetElapsedMs: 10604,
        targetDifferenceMs: 4,
        open: true,
        status: 'open',
        expiresAt: '2026-07-27T12:00:00Z',
        revision: 456,
      }),
    });
  });
}

async function expectNoHorizontalOverflow(page) {
  const sizes = await page.evaluate(() => ({
    viewport: globalThis.document.documentElement.clientWidth,
    content: globalThis.document.documentElement.scrollWidth,
  }));
  expect(sizes.content).toBeLessThanOrEqual(sizes.viewport + 1);
}

async function capture(page, testInfo, name) {
  if (!visualCapture) return;
  const device = testInfo.project.name.includes('mobile') ? 'mobile' : 'desktop';
  mkdirSync(previewRoot, { recursive: true });
  await page.screenshot({
    path: resolve(previewRoot, `${name}-${device}.png`),
    animations: 'disabled',
    fullPage: true,
  });
}

test('duel recipients see the exact verified time to beat', async ({ page }, testInfo) => {
  await installCommonMocks(page);
  await page.goto(`/?duel=${duelCode}`);

  const notice = page.locator('#duelNotice');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('Reto de VIEUCIRST');
  await expect(notice).toContainText('10.604 s');
  await expect(notice).toContainText('±4 ms del 10.600');
  await expect(notice).toContainText('quedar más cerca del objetivo');
  await expectNoHorizontalOverflow(page);
  await capture(page, testInfo, 'duel-target');
});

test('shared attempts use the public result URL without exposing Supabase', async ({ page }, testInfo) => {
  await installCommonMocks(page);
  await page.goto('/');
  await page.evaluate((attempt) => {
    document.querySelector('#setup')?.classList.remove('active');
    document.querySelector('#result')?.classList.add('active');
    document.dispatchEvent(new CustomEvent('minuto106:attempt-finished', { detail: { attempt } }));
  }, {
    id: resultId,
    nick: 'VIEUCIRST',
    team: 'spain',
    elapsedMs: 10604,
    differenceMs: 4,
    verified: true,
    createdAt: '2026-07-24T12:00:00Z',
    competitionType: 'global',
  });

  await page.locator('#shareButton').click();
  await expect.poll(() => page.evaluate(() => globalThis.__sharePayload ?? null)).not.toBeNull();
  const payload = await page.evaluate(() => globalThis.__sharePayload);
  const sharedUrl = new URL(payload.url);
  expect(payload.title).toContain('10.604 s');
  expect(payload.text).toContain('4 ms del 10.600');
  expect(sharedUrl.hostname).toBe('127.0.0.1');
  expect(sharedUrl.pathname).toBe('/');
  expect(sharedUrl.searchParams.get('sharedResult')).toBe(resultId);
  expect(payload.url).not.toContain('supabase.co');
  await expectNoHorizontalOverflow(page);
  await capture(page, testInfo, 'shared-result');
});

test('account player actions stay inside every card', async ({ page }, testInfo) => {
  await installCommonMocks(page);
  await page.goto('/cuenta.html');

  const cards = page.locator('.account-player');
  await expect(cards).toHaveCount(2);
  for (let index = 0; index < await cards.count(); index += 1) {
    const card = cards.nth(index);
    const cardBox = await card.boundingBox();
    expect(cardBox).not.toBeNull();
    for (const action of await card.locator('.account-player-actions > *').all()) {
      const actionBox = await action.boundingBox();
      expect(actionBox).not.toBeNull();
      expect(actionBox.x).toBeGreaterThanOrEqual(cardBox.x - 1);
      expect(actionBox.x + actionBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 1);
    }
  }
  await expectNoHorizontalOverflow(page);
  await capture(page, testInfo, 'account-actions');
});
