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

test('@live-ranked-anti-cheat renders readable numbers only inside the raster balls', async ({ page, request }) => {
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
  const solutionResponse = await request.post(readyEndpoint, {
    headers: {
      origin: 'http://127.0.0.1:3000',
      'content-type': 'application/json',
      'x-device-id': context.deviceId,
      'x-account-token': context.accountToken,
      'x-test-run-token': testToken,
    },
    data: {
      action: 'test-human-check-solution',
      checkId: publicChallenge.checkId,
    },
  });
  expect(solutionResponse.status()).toBe(200);
  const solution = await solutionResponse.json();
  expect(solution.balls).toHaveLength(4);

  const contrast = await challengeImage.evaluate((image, balls) => {
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context2d = canvas.getContext('2d', { willReadFrequently: true });
    context2d.drawImage(image, 0, 0);
    const pixels = context2d.getImageData(0, 0, canvas.width, canvas.height).data;

    return balls.map((ball) => {
      const centerX = canvas.width * Number(ball.x) / 100;
      const centerY = canvas.height * Number(ball.y) / 100;
      const radius = Math.max(24, Math.min(36, canvas.width * Number(ball.radius) / 100));
      const halfWidth = radius * 0.45;
      const halfHeight = radius * 0.55;
      let lightPixels = 0;
      let darkPixels = 0;

      for (let y = Math.floor(centerY - halfHeight); y <= Math.ceil(centerY + halfHeight); y += 1) {
        for (let x = Math.floor(centerX - halfWidth); x <= Math.ceil(centerX + halfWidth); x += 1) {
          if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) continue;
          const offset = (y * canvas.width + x) * 4;
          const red = pixels[offset];
          const green = pixels[offset + 1];
          const blue = pixels[offset + 2];
          const alpha = pixels[offset + 3];
          if (alpha === 255 && red >= 245 && green >= 245 && blue >= 245) lightPixels += 1;
          if (alpha === 255 && red <= 32 && green <= 32 && blue <= 40) darkPixels += 1;
        }
      }

      return { order: ball.order, lightPixels, darkPixels };
    });
  }, solution.balls);

  for (const ball of contrast) {
    expect(ball.lightPixels, `ball ${ball.order} light digit pixels`).toBeGreaterThanOrEqual(40);
    expect(ball.darkPixels, `ball ${ball.order} dark badge pixels`).toBeGreaterThanOrEqual(80);
  }

  await page.keyboard.press('Escape');
  await expect(page.locator('.human-check-overlay')).toBeHidden();
  await expect(page.locator('#startButton')).toBeFocused();
  expect(errors).toEqual([]);
  expect(failedRequests).toEqual([]);
});
