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
const storedConsent = JSON.stringify({ analytics: false, ads: false, updatedAt: '2026-07-27T00:00:00.000Z' });
const transparentPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
mkdirSync(previewDirectory, { recursive: true });

function evidenceName(isMobile) {
  return `daily-limit-countdown-${isMobile ? 'mobile' : 'desktop'}`;
}

function contextOptions(isMobile) {
  const device = isMobile
    ? devices['Pixel 5']
    : { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } };
  const options = {
    ...device,
    baseURL: applicationUrl,
    storageState: {
      cookies: [],
      origins: [{
        origin: applicationUrl,
        localStorage: [
          { name: 'minuto106:consent-v1', value: storedConsent },
          { name: 'minuto106:nick', value: 'DailyLimitPlayer' },
        ],
      }],
    },
  };
  if (captureEvidence) {
    const videoSize = isMobile ? { ...device.viewport } : { width: 1280, height: 800 };
    options.recordVideo = { dir: join(previewDirectory, 'recordings'), size: videoSize };
  }
  return options;
}

function stats() {
  return {
    targetMs: 10600,
    totalAttempts: 12,
    totalPlayers: 4,
    verifiedAttempts: 11,
    perfectAttempts: 0,
    teams: [{ team: 'spain', score: 120 }, { team: 'argentina', score: 80 }],
    leaderboard: [],
    awards: {},
    honoursRankings: { trophies: [], achievements: [] },
  };
}

function dailyProfile(resetAt, exhausted) {
  return {
    nick: 'DailyLimitPlayer',
    referralCode: '11111111-1111-4111-8111-111111111111',
    team: 'spain',
    history: [],
    attemptsUsed: exhausted ? 5 : 0,
    dailyAttemptsReserved: 0,
    attemptsLeft: exhausted ? 0 : 5,
    maxAttempts: 5,
    bonusAttempts: 0,
    completedReferrals: 0,
    dailyResetAt: resetAt,
    verifiedAttempts: exhausted ? 5 : 0,
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

async function installMocks(page, resetAtMs, requests) {
  await page.route('**/functions/v1/player-share/**', (route) => route.fulfill({
    status: 200,
    contentType: 'image/png',
    body: transparentPng,
  }));
  await page.route('**/functions/v1/player-context', async (route) => {
    requests.playerContext += 1;
    const resetAt = new Date(resetAtMs).toISOString();
    const exhausted = Date.now() < resetAtMs;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        availability: 'owned',
        profile: dailyProfile(resetAt, exhausted),
        leagues: [],
      }),
    });
  });
  await page.route('**/functions/v1/game-api', async (route) => {
    const body = bodyOf(route.request());
    if (body.action === 'stats') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stats()) });
      return;
    }
    if (['profile', 'public-profile', 'nick-status'].includes(body.action)) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(dailyProfile(new Date(resetAtMs).toISOString(), Date.now() < resetAtMs)),
      });
      return;
    }
    if (body.action === 'access-status') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ exists: true }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

test('exhausted daily global quota counts down and refreshes from the server at reset', async ({ browser, isMobile }) => {
  const context = await browser.newContext(contextOptions(isMobile));
  const page = await context.newPage();
  const video = captureEvidence ? page.video() : null;
  const pageErrors = [];
  const consoleErrors = [];
  const failedRequests = [];
  const requests = { playerContext: 0 };
  const resetAtMs = Date.now() + 7_000;

  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('requestfailed', (request) => failedRequests.push(`${request.method()} ${request.url()}`));
  await installMocks(page, resetAtMs, requests);

  try {
    await page.goto('/');
    const card = page.locator('#dailyLimitCard');
    const countdown = page.locator('#dailyLimitCountdown');
    const nickStatus = page.locator('#nickStatus');
    await expect(card).toBeVisible();
    await expect(page.locator('#dailyLimitCount')).toHaveText('5 de 5 intentos usados hoy');
    await expect(page.locator('#dailyLimitReferral')).toContainText('todos sus nicks');
    await expect(nickStatus).toHaveText('Has agotado tus 5 intentos globales de hoy.');
    await expect(nickStatus).not.toContainText(/\d{2}:\d{2}:\d{2}/);
    await expect(page.locator('#startButton')).toBeDisabled();
    await expect(countdown).toHaveText(/^00:00:0[1-7]$/);

    const initialCountdown = await countdown.textContent();
    await expect.poll(() => countdown.textContent()).not.toBe(initialCountdown);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    if (captureEvidence) {
      await page.screenshot({
        path: join(previewDirectory, `${evidenceName(isMobile)}.png`),
        animations: 'disabled',
        fullPage: true,
      });
    }

    await expect(card).toBeHidden({ timeout: 12_000 });
    await expect(nickStatus).toHaveText('5 de 5 intentos globales disponibles.');
    expect(requests.playerContext).toBeGreaterThanOrEqual(2);
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
  } finally {
    await context.close();
  }

  if (captureEvidence) {
    if (!video) throw new Error('Playwright did not create the daily-limit countdown recording.');
    await video.saveAs(join(previewDirectory, `${evidenceName(isMobile)}.webm`));
  }
});
