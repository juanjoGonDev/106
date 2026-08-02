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

function isExpectedNavigationAbort(request) {
  return request.resourceType() === 'image'
    && request.failure()?.errorText === 'net::ERR_ABORTED'
    && /\/functions\/v1\/player-share\/.+\/card\.png(?:\?|$)/.test(request.url());
}

async function clickAtPercent(page, locator, xPercent, yPercent, useTouch) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Interactive challenge bounds are unavailable.');
  const x = box.x + box.width * Number(xPercent) / 100;
  const y = box.y + box.height * Number(yPercent) / 100;
  if (useTouch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

async function clickRuntimeControl(page, useTouch) {
  const bounds = await page.locator('#playing').evaluate((playing) => {
    const host = [...playing.children].find((element) => element.tagName.toLowerCase().startsWith('m106-'))
      ?? [...playing.querySelectorAll('*')].find((element) => element.tagName.toLowerCase().startsWith('m106-'));
    if (!host) return null;
    const box = host.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  });
  if (!bounds) throw new Error('Runtime game control was not rendered.');
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  if (useTouch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

test('@live-ranked-anti-cheat keeps raster verification and client timing authoritative', async ({ page, request }, testInfo) => {
  const useTouch = testInfo.project.name.includes('mobile');
  const errors = [];
  const failedRequests = [];
  const challengeResponses = [];
  const finishRequests = [];
  const accountToken = randomBytes(32).toString('hex');
  const nick = unique('E2ERanked');

  page.on('pageerror', (error) => errors.push(`page: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('requestfailed', (failed) => {
    if (isExpectedNavigationAbort(failed)) return;
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

  await page.route('**/game-ready-api', async (route) => {
    const requestBody = route.request().postDataJSON?.() ?? {};
    if (requestBody.action === 'prepare-start') {
      requestBody.turnstileToken = `test-valid:e2e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      await route.continue({ postData: JSON.stringify(requestBody) });
      return;
    }
    await route.continue();
  });

  await page.route('**/game-api', async (route) => {
    const requestBody = route.request().postDataJSON?.() ?? {};
    if (requestBody.action === 'finish') {
      finishRequests.push(requestBody);
      await new Promise((resolve) => setTimeout(resolve, 600));
      await route.continue();
      return;
    }
    await route.continue();
  });

  await page.goto('/');
  await page.locator('#nick').fill(nick);
  await page.locator('.team-picker [data-team="spain"]').click();
  await expect(page.locator('#startButton')).toBeEnabled({ timeout: 15_000 });
  await page.locator('#startButton').click();

  const challengeImage = page.locator('.human-check-image');
  await expect(challengeImage).toBeVisible();
  await expect(challengeImage).toHaveAttribute('src', /^data:image\/png;base64,/);
  await expect(page.locator('.human-check-progress')).toHaveText('0 / 4');
  await expect(page.locator('.human-check-overlay')).not.toContainText(/Empieza por|Ahora pulsa el balón|balón siguiente/i);
  await expect.poll(() => challengeResponses.length).toBeGreaterThan(0);

  const publicChallenge = challengeResponses.at(-1);
  expect(publicChallenge).not.toHaveProperty('balls');
  expect(JSON.stringify(publicChallenge)).not.toMatch(/"(?:x|y|radius|order)"\s*:/);
  expect(publicChallenge.image.mediaType).toBe('image/png');

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

  for (const ball of solution.balls) {
    await clickAtPercent(page, challengeImage, ball.x, ball.y, useTouch);
  }
  await expect(page.locator('.human-check-overlay')).toBeHidden({ timeout: 15_000 });

  await expect(page.locator('.game-readiness-control')).toBeVisible();
  await clickRuntimeControl(page, useTouch);
  await expect(page.locator('.game-readiness-control')).toBeHidden({ timeout: 8_000 });
  await expect(page.locator('#timer')).toHaveClass(/concealed/, { timeout: 6_000 });

  await clickRuntimeControl(page, useTouch);
  await expect(page.locator('#result')).toHaveClass(/active/, { timeout: 15_000 });
  const displayedSeconds = Number(await page.locator('#resultTime').textContent());
  expect(displayedSeconds).toBeGreaterThanOrEqual(2);
  expect(displayedSeconds).toBeLessThan(3);
  expect(finishRequests).toHaveLength(1);
  expect(Number(finishRequests[0].clientElapsedMs)).toBeLessThan(3_000);
  await expect(page.locator('#verificationStatus')).toContainText('apto para el ranking');

  await page.reload();
  const profileResponse = page.waitForResponse((response) => {
    if (!response.url().endsWith('/player-context') || !response.ok()) return false;
    const body = response.request().postDataJSON?.() ?? {};
    return body.action === 'player-context' && body.nick === nick;
  }, { timeout: 25_000 });
  await page.locator('#nick').fill('');
  await page.locator('#nick').fill(nick);
  await profileResponse;
  await expect(page.locator('#profileCard')).toBeVisible({ timeout: 25_000 });
  await expect(page.locator('#attemptHistory')).toContainText(`${displayedSeconds.toFixed(3)} s`);

  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(horizontalOverflow).toBe(false);
  expect(errors).toEqual([]);
  expect(failedRequests).toEqual([]);
});

test('@live-ranked-anti-cheat cancels the neutral raster dialog with Escape', async ({ page }) => {
  const accountToken = randomBytes(32).toString('hex');
  await page.addInitScript(({ account }) => {
    localStorage.setItem('minuto106:account-access-v1', account);
  }, { account: accountToken });

  await page.goto('/');
  await page.locator('#nick').fill(unique('E2ECancel'));
  await page.locator('.team-picker [data-team="argentina"]').click();
  await expect(page.locator('#startButton')).toBeEnabled({ timeout: 15_000 });
  await page.locator('#startButton').click();
  await expect(page.locator('.human-check-overlay')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.human-check-overlay')).toBeHidden();
  await expect(page.locator('#setup')).toHaveClass(/active/);
  await expect(page.locator('#nick')).toBeFocused();
});
