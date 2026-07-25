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
const storedConsent = JSON.stringify({ analytics: false, ads: false, updatedAt: '2026-07-25T00:00:00.000Z' });
mkdirSync(previewDirectory, { recursive: true });

function bodyOf(request) {
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
    teams: [
      { team: 'spain', score: 0 },
      { team: 'argentina', score: 0 },
    ],
    leaderboard: [],
    awards: {
      goldenBoot: null,
      goldenGlove: null,
      goldenBall: null,
    },
    honoursRankings: {
      trophies: [],
      achievements: [],
    },
  };
}

async function installApiMock(page) {
  await page.route('**/functions/v1/game-api', async (route) => {
    const body = bodyOf(route.request());
    const payload = body.action === 'stats' ? stats() : {};
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    });
  });
  await page.route('**/functions/v1/player-context', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ availability: 'available', profile: null, leagues: [] }),
    });
  });
}

async function dispatchUnlock(page, { worldRecord = false } = {}) {
  await page.evaluate(({ isWorldRecord }) => {
    const previous = {
      achievements: {
        items: [{ code: 'precision_1000', title: 'Dentro del segundo' }],
      },
    };
    const next = {
      achievements: {
        items: [
          { code: 'precision_1000', title: 'Dentro del segundo' },
          {
            code: 'precision_250',
            title: 'Zona de precisión',
            description: 'Registraste una marca global a 250 ms o menos.',
            points: 10,
          },
        ],
      },
    };
    document.dispatchEvent(new CustomEvent('minuto106:player-context', {
      detail: { availability: 'owned', profile: previous },
    }));
    document.dispatchEvent(new CustomEvent('minuto106:attempt-finished', {
      detail: {
        profile: next,
        achievement: { isWorldRecord },
      },
    }));
  }, { isWorldRecord: worldRecord });
}

function evidenceName(isMobile) {
  return `achievement-unlock-${isMobile ? 'mobile' : 'desktop'}`;
}

function recordingContextOptions(isMobile) {
  const device = isMobile
    ? devices['Pixel 5']
    : { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } };
  return {
    ...device,
    baseURL: applicationUrl,
    recordVideo: {
      dir: join(previewDirectory, 'recordings'),
      size: isMobile ? { width: 390, height: 844 } : { width: 1280, height: 800 },
    },
    storageState: {
      cookies: [],
      origins: [{
        origin: applicationUrl,
        localStorage: [{ name: 'minuto106:consent-v1', value: storedConsent }],
      }],
    },
  };
}

async function expectInsideViewport(page, locator) {
  await expect.poll(async () => {
    const box = await locator.boundingBox();
    const viewport = page.viewportSize();
    if (!box || !viewport) return false;
    return box.x >= 0 && box.x + box.width <= viewport.width;
  }, { timeout: 2_000 }).toBe(true);
}

test('shows one responsive video-game notification for the newly unlocked achievement', async ({ page, isMobile }) => {
  await installApiMock(page);
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.Minuto106AchievementUnlockNotifier));
  await dispatchUnlock(page);

  const notification = page.locator('.achievement-unlock');
  await expect(notification).toBeVisible();
  await expect(notification.locator('.achievement-unlock__kicker')).toHaveText('LOGRO DESBLOQUEADO');
  await expect(notification.locator('.achievement-unlock__title')).toHaveText('Zona de precisión');
  await expect(notification.locator('.achievement-unlock__description')).toContainText('250 ms o menos');
  await expect(notification.locator('.achievement-unlock__points')).toHaveText('+10 PUNTOS');
  await expect(notification).toHaveClass(/is-visible/);
  await expectInsideViewport(page, notification);

  if (captureEvidence) {
    await page.screenshot({
      path: join(previewDirectory, `${evidenceName(isMobile)}.png`),
      animations: 'disabled',
    });
  }
});

test('records the complete unlock lifecycle in the whole viewport', async ({ browser, isMobile }) => {
  test.skip(!captureEvidence, 'Visual recording is generated only by the PR evidence workflow.');
  const context = await browser.newContext(recordingContextOptions(isMobile));
  const page = await context.newPage();
  await installApiMock(page);
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.Minuto106AchievementUnlockNotifier));
  await page.waitForTimeout(700);
  await dispatchUnlock(page);

  const notification = page.locator('.achievement-unlock');
  await expect(notification).toBeVisible();
  await page.waitForTimeout(3_800);
  await expect(notification).toBeHidden();

  const video = page.video();
  if (!video) throw new Error('Playwright did not create the requested unlock recording.');
  await context.close();
  await video.saveAs(join(previewDirectory, `${evidenceName(isMobile)}.webm`));
});

test('keeps the same information without motion when reduced motion is enabled', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await installApiMock(page);
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.Minuto106AchievementUnlockNotifier));
  await dispatchUnlock(page);

  const notification = page.locator('.achievement-unlock');
  await expect(notification).toBeVisible();
  await expect.poll(async () => notification.evaluate((element) => getComputedStyle(element).transform)).toBe('none');
  await expect.poll(async () => notification.locator('.achievement-unlock__badge').evaluate((element) => getComputedStyle(element).animationName)).toBe('none');
});
