import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const runtimePath = process.env.PLAYWRIGHT_TEST_PATH;
if (!runtimePath) throw new Error('PLAYWRIGHT_TEST_PATH is required. Run Playwright through pnpm test:e2e.');
const require = createRequire(import.meta.url);
const { devices, expect, test } = require(runtimePath);

const applicationUrl = 'http://127.0.0.1:3000';
const previewDirectory = '.tmp/pr-previews';
const captureEvidence = process.env.PR_VISUAL_CAPTURE === '1';
const evidenceId = 'account-daily-attempt-policy';
const accountToken = 'a'.repeat(64);
const accountPolicy = {
  attemptsUsed: 0,
  dailyAttemptsReserved: 0,
  attemptsLeft: 6,
  maxAttempts: 6,
  bonusAttempts: 1,
  authRewardBonus: 1,
  completedReferrals: 0,
  dailyLimitBase: 5,
  dailyLimitCeiling: 10,
  dailyResetAt: '2026-07-31T00:00:00.000Z',
};

mkdirSync(previewDirectory, { recursive: true });

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
          {
            name: 'minuto106:consent-v1',
            value: JSON.stringify({ analytics: false, ads: false, updatedAt: '2026-07-30T15:00:00.000Z' }),
          },
          { name: 'minuto106:account-access-v1', value: accountToken },
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

function requestBody(request) {
  try {
    return request.postDataJSON() || {};
  } catch {
    return {};
  }
}

function stats() {
  return {
    targetMs: 10600,
    totalAttempts: 0,
    totalPlayers: 0,
    verifiedAttempts: 0,
    perfectAttempts: 0,
    teams: [{ team: 'spain', score: 0 }, { team: 'argentina', score: 0 }],
    leaderboard: [],
    awards: {},
    honoursRankings: { trophies: [], achievements: [] },
  };
}

async function installMocks(page, requests) {
  await page.route('**/functions/v1/player-context', async (route) => {
    const body = requestBody(route.request());
    requests.playerContext.push(body.action);
    expect(route.request().headers()['x-account-token']).toBe(accountToken);
    if (body.action === 'account-context') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ dailyAttemptPolicy: accountPolicy }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ availability: 'available', profile: null, leagues: [], dailyAttemptPolicy: accountPolicy }),
    });
  });
  await page.route('**/functions/v1/game-api', async (route) => {
    const body = requestBody(route.request());
    requests.gameApi.push(body.action);
    if (body.action === 'stats') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stats()) });
      return;
    }
    if (body.action === 'access-status') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ exists: false }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

async function assertNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test('confirmed account without a nick uses the canonical six-attempt policy', async ({ browser, isMobile }) => {
  const context = await browser.newContext(contextOptions(isMobile));
  const page = await context.newPage();
  const video = captureEvidence ? page.video() : null;
  const pageErrors = [];
  const consoleErrors = [];
  const failedRequests = [];
  const requests = { gameApi: [], playerContext: [] };

  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('requestfailed', (request) => failedRequests.push(`${request.method()} ${request.url()}`));
  await installMocks(page, requests);

  try {
    await page.goto('/');
    await expect(page.locator('#nick')).toHaveValue('');
    await expect(page.locator('#competitionPickerSection')).toBeVisible();
    await expect(page.locator('#competitionPicker option:checked')).toHaveText('Global · 6/6 tiros');
    await expect(page.locator('#startButton')).toBeDisabled();
    expect(requests.playerContext).toEqual(['account-context']);
    await assertNoHorizontalOverflow(page);

    if (captureEvidence) {
      await page.screenshot({
        path: join(previewDirectory, `${evidenceId}-${isMobile ? 'mobile' : 'desktop'}.png`),
        animations: 'disabled',
        fullPage: true,
      });
    }

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
  } finally {
    await context.close();
  }

  if (captureEvidence) {
    if (!video) throw new Error('Playwright did not create the account daily-attempt recording.');
    await video.saveAs(join(previewDirectory, `${evidenceId}-${isMobile ? 'mobile' : 'desktop'}.webm`));
  }
});
