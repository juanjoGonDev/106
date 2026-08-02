import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const runtimePath = process.env.PLAYWRIGHT_TEST_PATH;
if (!runtimePath) throw new Error('PLAYWRIGHT_TEST_PATH is required. Run Playwright through pnpm test:e2e.');
const require = createRequire(import.meta.url);
const { expect, test } = require(runtimePath);
const previewDirectory = '.tmp/pr-previews';
const captureVisualEvidence = process.env.PR_VISUAL_CAPTURE === '1';
mkdirSync(previewDirectory, { recursive: true });

function bodyOf(request) {
  try {
    return request.postDataJSON() || {};
  } catch {
    return {};
  }
}

function statsSnapshot(resetAt) {
  return {
    totalAttempts: 18,
    totalPlayers: 6,
    verifiedAttempts: 17,
    perfectAttempts: 1,
    teams: [
      { team: 'spain', score: 12 },
      { team: 'argentina', score: 8 },
    ],
    leaderboard: [
      { nick: 'ResetWinner', team: 'spain', elapsedMs: 10_600, differenceMs: 0 },
    ],
    awards: {
      date: '2026-08-02',
      resetAt,
      provisional: true,
      goldenBoot: { nick: 'ResetWinner', team: 'spain', value: 0 },
      goldenGlove: { nick: 'ResetAverage', team: 'argentina', value: 8 },
      goldenBall: { nick: 'ResetActive', team: 'spain', value: 5 },
    },
  };
}

function countdownSeconds(value) {
  const parts = String(value).split(':').map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return -1;
  return parts[0] * 3_600 + parts[1] * 60 + parts[2];
}

async function installStatsRoute(page, responseForRequest) {
  await page.route('**/functions/v1/game-api', async (route) => {
    const body = bodyOf(route.request());
    if (body.action === 'stats') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(responseForRequest()),
      });
      return;
    }
    if (body.action === 'access-status') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ exists: false }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

test('daily awards count down to zero, refresh once and follow the next server reset', async ({ page }, testInfo) => {
  let statsRequests = 0;
  const firstResetAt = new Date(Date.now() + 4_500).toISOString();
  await installStatsRoute(page, () => {
    statsRequests += 1;
    return statsSnapshot(statsRequests === 1
      ? firstResetAt
      : new Date(Date.now() + 90_000).toISOString());
  });

  await page.goto('/?awards-reset=countdown', { waitUntil: 'domcontentloaded' });
  const countdown = page.locator('#awardsResetCountdown');
  await expect(countdown).toHaveText(/^\d{2}:\d{2}:\d{2}$/);
  const initialSeconds = countdownSeconds(await countdown.textContent());
  expect(initialSeconds).toBeGreaterThan(0);
  expect(initialSeconds).toBeLessThanOrEqual(5);

  await expect.poll(() => statsRequests, { timeout: 9_000 }).toBe(2);
  await expect.poll(async () => countdownSeconds(await countdown.textContent()), { timeout: 3_000 })
    .toBeGreaterThan(70);
  await expect(countdown).not.toHaveText('00:00:00');

  await page.waitForTimeout(1_300);
  expect(statsRequests).toBe(2);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);

  if (captureVisualEvidence) {
    await page.screenshot({
      path: join(previewDirectory, `awards-reset-countdown-${testInfo.project.name.includes('mobile') ? 'mobile' : 'desktop'}.png`),
      fullPage: true,
      animations: 'disabled',
    });
  }
});

test('missing reset metadata stays unavailable without inventing a client clock', async ({ page }) => {
  let statsRequests = 0;
  await installStatsRoute(page, () => {
    statsRequests += 1;
    return statsSnapshot(undefined);
  });

  await page.goto('/?awards-reset=missing', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#awardsResetCountdown')).toHaveText('—');
  await page.waitForTimeout(1_300);
  expect(statsRequests).toBe(1);
});

test('a stale zero remaining field cannot block a fresh zero-used daily quota', async ({ page }, testInfo) => {
  await installStatsRoute(page, () => statsSnapshot(new Date(Date.now() + 60_000).toISOString()));
  await page.goto('/?daily-limit=fresh-state', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#dailyLimitCard')).toBeAttached();

  const resetAt = new Date(Date.now() + 60_000).toISOString();
  await page.evaluate((dailyResetAt) => {
    document.dispatchEvent(new CustomEvent('minuto106:player-context', {
      detail: {
        availability: 'owned',
        selected: { type: 'global' },
        profile: {
          nick: 'FreshQuota',
          attemptsUsed: 0,
          dailyAttemptsReserved: 0,
          attemptsLeft: 0,
          maxAttempts: 5,
          dailyResetAt,
        },
      },
    }));
  }, resetAt);
  await expect(page.locator('#dailyLimitCard')).toBeHidden();

  await page.evaluate((dailyResetAt) => {
    document.dispatchEvent(new CustomEvent('minuto106:player-context', {
      detail: {
        availability: 'owned',
        selected: { type: 'global' },
        profile: {
          nick: 'FreshQuota',
          attemptsUsed: 5,
          dailyAttemptsReserved: 0,
          attemptsLeft: 5,
          maxAttempts: 5,
          dailyResetAt,
        },
      },
    }));
  }, resetAt);
  await expect(page.locator('#dailyLimitCard')).toBeVisible();
  await expect(page.locator('#dailyLimitCount')).toHaveText('5 de 5 intentos usados hoy');

  await page.evaluate((dailyResetAt) => {
    document.dispatchEvent(new CustomEvent('minuto106:player-context', {
      detail: {
        availability: 'owned',
        selected: { type: 'global' },
        profile: {
          nick: 'FreshQuota',
          attemptsUsed: 0,
          dailyAttemptsReserved: 0,
          attemptsLeft: 0,
          maxAttempts: 5,
          dailyResetAt,
        },
      },
    }));
  }, resetAt);
  await expect(page.locator('#dailyLimitCard')).toBeHidden();

  if (captureVisualEvidence) {
    await page.screenshot({
      path: join(previewDirectory, `fresh-daily-quota-${testInfo.project.name.includes('mobile') ? 'mobile' : 'desktop'}.png`),
      fullPage: true,
      animations: 'disabled',
    });
  }
});
