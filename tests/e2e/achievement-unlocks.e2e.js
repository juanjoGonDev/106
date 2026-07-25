import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const runtimePath = process.env.PLAYWRIGHT_TEST_PATH;
if (!runtimePath) throw new Error('PLAYWRIGHT_TEST_PATH is required. Run Playwright through pnpm test:e2e.');
const require = createRequire(import.meta.url);
const { expect, test } = require(runtimePath);
const previewDirectory = '.tmp/pr-previews';
const captureEvidence = process.env.PR_VISUAL_CAPTURE === '1';
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

async function captureFrame(page, frameDirectory, index) {
  await page.screenshot({
    path: join(frameDirectory, `${String(index).padStart(3, '0')}.png`),
    animations: 'allow',
  });
}

async function beginUnlockEvidence(page, isMobile) {
  if (!captureEvidence) {
    await dispatchUnlock(page);
    return null;
  }

  const frameDirectory = join(previewDirectory, 'frames', evidenceName(isMobile));
  mkdirSync(frameDirectory, { recursive: true });
  let frame = 0;
  await captureFrame(page, frameDirectory, frame);
  frame += 1;
  await dispatchUnlock(page);

  for (const delayMs of [100, 120, 140, 180, 250]) {
    await page.waitForTimeout(delayMs);
    await captureFrame(page, frameDirectory, frame);
    frame += 1;
  }
  return { frame, frameDirectory };
}

async function completeUnlockEvidence(page, evidence) {
  if (!evidence) return;
  for (const delayMs of [300, 450, 600, 700, 700, 700, 500]) {
    await page.waitForTimeout(delayMs);
    await captureFrame(page, evidence.frameDirectory, evidence.frame);
    evidence.frame += 1;
  }
}

test('shows one responsive video-game notification for the newly unlocked achievement', async ({ page, isMobile }) => {
  await installApiMock(page);
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.Minuto106AchievementUnlockNotifier));
  const evidence = await beginUnlockEvidence(page, isMobile);

  const notification = page.locator('.achievement-unlock');
  await expect(notification).toBeVisible();
  await expect(notification.locator('.achievement-unlock__kicker')).toHaveText('LOGRO DESBLOQUEADO');
  await expect(notification.locator('.achievement-unlock__title')).toHaveText('Zona de precisión');
  await expect(notification.locator('.achievement-unlock__description')).toContainText('250 ms o menos');
  await expect(notification.locator('.achievement-unlock__points')).toHaveText('+10 PUNTOS');
  await expect(notification).toHaveClass(/is-visible/);

  const box = await notification.boundingBox();
  expect(box).not.toBeNull();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width);

  if (captureEvidence) {
    await page.screenshot({
      path: join(previewDirectory, `${evidenceName(isMobile)}.png`),
      animations: 'disabled',
    });
  }
  await completeUnlockEvidence(page, evidence);
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
