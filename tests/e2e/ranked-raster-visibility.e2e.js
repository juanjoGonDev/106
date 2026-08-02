import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';

const runtimePath = process.env.PLAYWRIGHT_TEST_PATH;
if (!runtimePath) throw new Error('PLAYWRIGHT_TEST_PATH is required. Run Playwright through pnpm test:e2e.');
const require = createRequire(import.meta.url);
const { expect, test } = require(runtimePath);

const apiUrl = process.env.SUPABASE_TEST_URL ?? 'http://127.0.0.1:54321';
const readyEndpoint = `${apiUrl.replace(/\/$/, '')}/functions/v1/game-ready-api`;
const testToken = process.env.LOCAL_E2E_TEST_TOKEN ?? 'ci-local-ranked-anti-cheat-106';

function unique(label) {
  return `${label}${Date.now().toString(36)}${randomBytes(2).toString('hex')}`.slice(0, 24);
}

function isExpectedCancelledRequest(request) {
  return request.failure()?.errorText === 'net::ERR_ABORTED'
    && request.url().endsWith('/game-ready-api');
}

async function clickAtPercent(page, locator, ball, useTouch) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Interactive challenge bounds are unavailable.');
  const x = box.x + box.width * Number(ball.x) / 100;
  const y = box.y + box.height * Number(ball.y) / 100;
  if (useTouch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

async function inspectRaster(page, dataUrl, balls) {
  return page.evaluate(async ({ source, layout }) => {
    const image = new Image();
    image.src = source;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;

    const pixelAt = (x, y) => {
      const px = Math.max(0, Math.min(canvas.width - 1, Math.round(x)));
      const py = Math.max(0, Math.min(canvas.height - 1, Math.round(y)));
      const offset = (py * canvas.width + px) * 4;
      return [...pixels.slice(offset, offset + 4)];
    };

    return layout.map((ball) => {
      const centerX = canvas.width * Number(ball.x) / 100;
      const centerY = canvas.height * Number(ball.y) / 100;
      const radius = Math.max(24, Math.min(36, canvas.width * Number(ball.radius) / 100));
      let lightPixels = 0;
      let darkPixels = 0;
      for (let y = Math.floor(centerY - radius * 0.45); y <= Math.ceil(centerY + radius * 0.45); y += 1) {
        for (let x = Math.floor(centerX - radius * 0.45); x <= Math.ceil(centerX + radius * 0.45); x += 1) {
          const [red, green, blue, alpha] = pixelAt(x, y);
          if (alpha === 255 && red >= 245 && green >= 245 && blue >= 245) lightPixels += 1;
          if (alpha === 255 && red <= 32 && green <= 32 && blue <= 40) darkPixels += 1;
        }
      }
      return {
        order: ball.order,
        outerFill: pixelAt(centerX + radius * 0.7, centerY),
        lightPixels,
        darkPixels,
      };
    });
  }, { source: dataUrl, layout: balls });
}

function assertAppearance(appearance, selectedCount) {
  for (const ball of appearance) {
    const selected = Number(ball.order) <= selectedCount;
    expect(ball.outerFill, `ball ${ball.order} fill at progress ${selectedCount}`).toEqual(
      selected ? [84, 209, 139, 255] : [247, 248, 251, 255],
    );
    expect(ball.lightPixels, `ball ${ball.order} readable number`).toBeGreaterThanOrEqual(30);
    expect(ball.darkPixels, `ball ${ball.order} legacy pentagon`).toBeGreaterThanOrEqual(90);
  }
}

test('@live-ranked-anti-cheat renders legacy footballs and confirms every selected state', async ({ page, request }, testInfo) => {
  const useTouch = testInfo.project.name.includes('mobile');
  const accountToken = randomBytes(32).toString('hex');
  const nick = unique('E2ERaster');
  const errors = [];
  const failedRequests = [];
  const challengeResponses = [];

  page.on('pageerror', (error) => errors.push(`page: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('requestfailed', (failed) => {
    if (isExpectedCancelledRequest(failed)) return;
    failedRequests.push(`${failed.method()} ${failed.url()} ${failed.failure()?.errorText ?? ''}`);
  });
  page.on('response', async (response) => {
    if (!response.url().endsWith('/game-ready-api')) return;
    const requestBody = response.request().postDataJSON?.() ?? {};
    if (requestBody.action !== 'human-check') return;
    challengeResponses.push(await response.json());
  });

  await page.addInitScript(({ account }) => {
    localStorage.setItem('minuto106:account-access-v1', account);
  }, { account: accountToken });

  await page.goto('/');
  await page.locator('#nick').fill(nick);
  await page.locator('.team-picker [data-team="spain"]').click();
  await expect(page.locator('#startButton')).toBeEnabled({ timeout: 15_000 });
  await page.locator('#startButton').click();

  const challengeImage = page.locator('.human-check-image');
  await expect(challengeImage).toBeVisible();
  await expect(challengeImage).toHaveAttribute('src', /^data:image\/png;base64,/);
  await expect(page.locator('.human-check-overlay')).not.toContainText(/Empieza por|Ahora pulsa el balón|balón siguiente/i);
  await expect.poll(() => challengeResponses.length).toBeGreaterThan(0);

  const publicChallenge = challengeResponses.at(-1);
  expect(publicChallenge).not.toHaveProperty('balls');
  expect(JSON.stringify(publicChallenge)).not.toMatch(/"(?:x|y|radius|order)"\s*:/);

  const context = await page.evaluate(() => ({
    deviceId: localStorage.getItem('minuto106:device-id'),
    accountToken: localStorage.getItem('minuto106:account-access-v1'),
  }));
  const requestHeaders = {
    origin: 'http://127.0.0.1:3000',
    'content-type': 'application/json',
    'x-device-id': context.deviceId,
    'x-account-token': context.accountToken,
  };
  const solutionResponse = await request.post(readyEndpoint, {
    headers: { ...requestHeaders, 'x-test-run-token': testToken },
    data: {
      action: 'test-human-check-solution',
      checkId: publicChallenge.checkId,
    },
  });
  expect(solutionResponse.status()).toBe(200);
  const solution = await solutionResponse.json();
  expect(solution.balls).toHaveLength(4);

  assertAppearance(await inspectRaster(page, publicChallenge.image.dataUrl, solution.balls), 0);
  let previousDigest = publicChallenge.image.digest;
  let previousStateVersion = 0;
  let finalPayload = null;

  for (let index = 0; index < solution.balls.length; index += 1) {
    const responsePromise = page.waitForResponse((response) => {
      if (!response.url().endsWith('/game-ready-api')) return false;
      const body = response.request().postDataJSON?.() ?? {};
      return body.action === 'human-check-click' && body.checkId === publicChallenge.checkId;
    });
    await clickAtPercent(page, challengeImage, solution.balls[index], useTouch);
    const response = await responsePromise;
    expect(response.status()).toBe(index === 3 ? 201 : 200);
    const payload = await response.json();
    expect(payload.selectedCount).toBe(index + 1);
    expect(payload.stateVersion).toBe(previousStateVersion + 1);
    expect(payload.image.digest).not.toBe(previousDigest);
    expect(payload).not.toHaveProperty('balls');
    expect(JSON.stringify(payload)).not.toMatch(/"(?:x|y|radius|order)"\s*:/);
    assertAppearance(await inspectRaster(page, payload.image.dataUrl, solution.balls), index + 1);

    if (index < 3) {
      await expect(page.locator('.human-check-progress')).toHaveText(`${index + 1} / 4`);
      await expect(challengeImage).toHaveAttribute('data-digest', payload.image.digest);
    }
    previousDigest = payload.image.digest;
    previousStateVersion = payload.stateVersion;
    finalPayload = payload;
  }

  expect(finalPayload.completed).toBe(true);
  expect(finalPayload.proofToken).toMatch(/^[a-f0-9]{64}$/);
  await expect(page.locator('.human-check-overlay')).toBeHidden({ timeout: 15_000 });

  const replay = await request.post(readyEndpoint, {
    headers: requestHeaders,
    data: {
      action: 'human-check-click',
      checkId: publicChallenge.checkId,
      click: {
        x: solution.balls[3].x,
        y: solution.balls[3].y,
        atMs: 2_000,
        pointerType: useTouch ? 'touch' : 'mouse',
      },
      stateVersion: 3,
    },
  });
  expect(replay.status()).toBe(409);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
  expect(errors).toEqual([]);
  expect(failedRequests).toEqual([]);
});
