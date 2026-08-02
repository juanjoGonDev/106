import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { renderHumanCheckRaster } from '../../supabase/functions/_shared/human-check-raster.js';

const runtimePath = process.env.PLAYWRIGHT_TEST_PATH;
if (!runtimePath) throw new Error('PLAYWRIGHT_TEST_PATH is required. Run Playwright through pnpm test:e2e.');
const require = createRequire(import.meta.url);
const { devices, expect, test } = require(runtimePath);

const previewDirectory = '.tmp/pr-previews';
const captureEvidence = process.env.PR_VISUAL_CAPTURE === '1';
const applicationUrl = 'http://127.0.0.1:3000';
const storedConsent = JSON.stringify({ analytics: false, ads: false, updatedAt: '2026-07-25T00:00:00.000Z' });
const checkId = '11111111-1111-4111-8111-111111111111';
const challengeId = '22222222-2222-4222-8222-222222222222';
const balls = Object.freeze([
  Object.freeze({ order: 1, x: 20, y: 25, radius: 8 }),
  Object.freeze({ order: 2, x: 80, y: 25, radius: 8 }),
  Object.freeze({ order: 3, x: 20, y: 75, radius: 8 }),
  Object.freeze({ order: 4, x: 80, y: 75, radius: 8 }),
]);
const rasterStates = await Promise.all(
  Array.from({ length: 5 }, (_, selectedCount) => renderHumanCheckRaster(balls, { selectedCount })),
);
mkdirSync(previewDirectory, { recursive: true });

function bodyOf(request) {
  try {
    return request.postDataJSON() || {};
  } catch {
    return {};
  }
}

function publicImage(raster) {
  return {
    mediaType: raster.mediaType,
    dataUrl: raster.dataUrl,
    width: raster.width,
    height: raster.height,
    digest: raster.digest,
  };
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
    awards: { goldenBoot: null, goldenGlove: null, goldenBall: null },
  };
}

function profile(nick = 'EvidencePlayer') {
  return {
    nick,
    team: 'spain',
    history: [],
    attemptsUsed: 0,
    verifiedAttempts: 0,
    maxAttempts: 5,
    attemptsLeft: 5,
    trophies: { total: 0, history: [] },
    achievements: { total: 0, points: 0, items: [] },
  };
}

async function installMocks(page) {
  let selectedCount = 0;
  let stateVersion = 0;

  await page.route('**/functions/v1/player-context', async (route) => {
    const body = bodyOf(route.request());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        availability: 'owned',
        profile: profile(body.nick || 'EvidencePlayer'),
        leagues: [],
      }),
    });
  });

  await page.route('**/functions/v1/game-ready-api', async (route) => {
    const body = bodyOf(route.request());
    if (body.action === 'human-check') {
      selectedCount = 0;
      stateVersion = 0;
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          checkId,
          selectedCount,
          stateVersion,
          expiresAt: new Date(Date.now() + 120_000).toISOString(),
          image: publicImage(rasterStates[0]),
        }),
      });
      return;
    }

    if (body.action === 'human-check-click') {
      const expected = balls[selectedCount];
      const click = body.click || {};
      const correct = expected
        && body.checkId === checkId
        && body.stateVersion === stateVersion
        && Math.hypot(Number(click.x) - expected.x, Number(click.y) - expected.y) <= expected.radius;
      if (!correct) {
        await route.fulfill({
          status: body.stateVersion === stateVersion ? 400 : 409,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'La verificación no es válida.' }),
        });
        return;
      }

      selectedCount += 1;
      stateVersion += 1;
      const completed = selectedCount === balls.length;
      await route.fulfill({
        status: completed ? 201 : 200,
        contentType: 'application/json',
        body: JSON.stringify({
          checkId,
          selectedCount,
          stateVersion,
          completed,
          expiresAt: new Date(Date.now() + 120_000).toISOString(),
          image: publicImage(rasterStates[selectedCount]),
          ...(completed ? { proofToken: 'a'.repeat(64) } : {}),
        }),
      });
      return;
    }

    if (body.action === 'prepare-start') {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          prepared: true,
          challengeId,
          readyExpiresAt: new Date(Date.now() + 120_000).toISOString(),
          interaction: {
            mode: 'press',
            nonce: '550e8400-e29b-41d4-a716-446655440000',
            xPercent: 50,
            yPercent: 50,
            variant: 0,
          },
        }),
      });
      return;
    }

    if (body.action === 'activate-start') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ startsAt: new Date(Date.now() + 3_000).toISOString() }),
      });
      return;
    }

    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });

  await page.route('**/functions/v1/game-api', async (route) => {
    const body = bodyOf(route.request());
    const payload = body.action === 'stats'
      ? stats()
      : body.action === 'access-status'
        ? { exists: false }
        : profile(body.nick || 'EvidencePlayer');
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
  });
}

async function holdCompletedOverlay(page) {
  await page.addInitScript(() => {
    const originalRemove = Element.prototype.remove;
    Element.prototype.remove = function removeWithEvidenceHold() {
      const completed = this.classList?.contains('human-check-overlay')
        && this.querySelector?.('.human-check-progress')?.textContent === '4 / 4';
      if (completed) {
        this.dataset.evidenceHold = 'completed';
        return;
      }
      originalRemove.call(this);
    };
  });
}

async function startChallenge(page) {
  await page.goto('/');
  await page.locator('#nick').fill('EvidencePlayer');
  await page.getByRole('button', { name: 'España', exact: true }).click();
  await expect(page.locator('#startButton')).toBeEnabled();
  await page.locator('#startButton').click();
  await expect(page.locator('.human-check-image')).toBeVisible();
  await expect(page.locator('.human-check-progress')).toHaveText('0 / 4');
}

async function clickBall(page, ball, expectedCount) {
  const image = page.locator('.human-check-image');
  const previousDigest = await image.getAttribute('data-digest');
  const bounds = await image.boundingBox();
  if (!bounds) throw new Error('Human-check image has no interactive bounds.');
  await page.mouse.click(
    bounds.x + bounds.width * ball.x / 100,
    bounds.y + bounds.height * ball.y / 100,
  );
  await expect(page.locator('.human-check-progress')).toHaveText(`${expectedCount} / 4`);
  await expect(image).not.toHaveAttribute('data-digest', previousDigest);
}

function evidencePath(area, isMobile, extension) {
  return join(previewDirectory, `${area}-${isMobile ? 'mobile' : 'desktop'}.${extension}`);
}

async function captureViewport(page, area, isMobile) {
  if (!captureEvidence) return;
  await page.screenshot({ path: evidencePath(area, isMobile, 'png'), animations: 'disabled' });
}

function recordingContextOptions(isMobile) {
  const device = isMobile
    ? devices['Pixel 5']
    : { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } };
  const videoSize = isMobile ? { ...device.viewport } : { width: 1280, height: 800 };
  return {
    ...device,
    baseURL: applicationUrl,
    recordVideo: { dir: join(previewDirectory, 'recordings'), size: videoSize },
    storageState: {
      cookies: [],
      origins: [{
        origin: applicationUrl,
        localStorage: [{ name: 'minuto106:consent-v1', value: storedConsent }],
      }],
    },
  };
}

test('captures the initial, confirmed and completed football states', async ({ page, isMobile }) => {
  await holdCompletedOverlay(page);
  await installMocks(page);
  await startChallenge(page);
  await captureViewport(page, 'human-check-initial', isMobile);

  await clickBall(page, balls[0], 1);
  await expect(page.locator('.human-check-status')).toContainText('1 de 4 balones confirmados');
  await captureViewport(page, 'human-check-selected', isMobile);

  await clickBall(page, balls[1], 2);
  await clickBall(page, balls[2], 3);
  await clickBall(page, balls[3], 4);
  await expect(page.locator('.human-check-overlay[data-evidence-hold="completed"]')).toBeVisible();
  await expect(page.locator('.human-check-status')).toHaveText('Verificación completada.');
  await captureViewport(page, 'human-check-completed', isMobile);

  await expect(page.locator('.human-check-overlay')).not.toContainText(/Empieza por|Ahora pulsa el balón|balón siguiente/i);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
});

test('records the server-confirmed football progression', async ({ browser, isMobile }) => {
  test.skip(!captureEvidence, 'Visual recording is generated only by the PR evidence workflow.');
  const context = await browser.newContext(recordingContextOptions(isMobile));
  const page = await context.newPage();
  await holdCompletedOverlay(page);
  await installMocks(page);
  await startChallenge(page);
  await page.waitForTimeout(500);
  for (let index = 0; index < balls.length; index += 1) {
    await clickBall(page, balls[index], index + 1);
    await page.waitForTimeout(450);
  }
  await expect(page.locator('.human-check-overlay[data-evidence-hold="completed"]')).toBeVisible();
  await page.waitForTimeout(700);

  const video = page.video();
  if (!video) throw new Error('Playwright did not create the progressive football recording.');
  await context.close();
  await video.saveAs(evidencePath('human-check-progress', isMobile, 'webm'));
});
