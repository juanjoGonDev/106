import { createRequire } from 'node:module';

const runtimePath = process.env.PLAYWRIGHT_TEST_PATH;
if (!runtimePath) throw new Error('PLAYWRIGHT_TEST_PATH is required. Run Playwright through pnpm test:e2e.');
const require = createRequire(import.meta.url);
const { expect, test } = require(runtimePath);

function bodyOf(request) {
  try {
    return request.postDataJSON() || {};
  } catch {
    return {};
  }
}

async function installRuntime(page) {
  await page.route('**/config.js*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `window.__MINUTO106_CONFIG__ = ${JSON.stringify({
        apiBaseUrl: 'https://project.supabase.co/functions/v1/game-api',
        supabaseUrl: 'https://project.supabase.co',
        supabasePublishableKey: `sb_publishable_${'a'.repeat(32)}`,
        turnstileSiteKey: 'test-turnstile-key',
        publicSiteUrl: 'http://127.0.0.1:3000',
      })};`,
    });
  });

  await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `window.turnstile = {
        render(_selector, options) { queueMicrotask(() => options.callback('test-token')); return 106; },
        reset() {}
      };`,
    });
  });

  await page.route('**/functions/v1/game-api', async (route) => {
    const body = bodyOf(route.request());
    if (body.action === 'stats') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          targetMs: 10600,
          leaderboard: [],
          awards: {},
          honoursRankings: { trophies: [], achievements: [] },
          scores: { spain: 0, argentina: 0 },
          totalPlayers: 0,
          verifiedAttempts: 0,
          perfectAttempts: 0,
        }),
      });
      return;
    }
    await route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Unexpected game action in nickname test.' }),
    });
  });

  await page.route('**/functions/v1/player-context', async (route) => {
    const body = bodyOf(route.request());
    const nick = String(body.nick || '');
    const availability = nick === 'admin'
      ? 'invalid-reserved'
      : nick === 'pedofilo'
        ? 'invalid-offensive'
        : nick.includes('/')
          ? 'invalid-invalid_characters'
          : 'available';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ availability, profile: null, leagues: [] }),
    });
  });
}

function trackRuntimeErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(`page: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('requestfailed', (request) => errors.push(`request: ${request.url()} ${request.failure()?.errorText || ''}`));
  return errors;
}

async function fillAndWaitForLookup(page, value) {
  const responsePromise = page.waitForResponse((response) => {
    if (!response.url().endsWith('/functions/v1/player-context')) return false;
    return bodyOf(response.request()).nick === value;
  });
  await page.locator('#nick').fill(value);
  await responsePromise;
}

test('nickname eligibility is resolved before CAPTCHA and malformed values never start', async ({ page }) => {
  await installRuntime(page);
  const errors = trackRuntimeErrors(page);
  await page.goto('/');

  const nick = page.locator('#nick');
  const status = page.locator('#nickStatus');
  const start = page.locator('#startButton');
  const captcha = page.locator('#turnstileContainer');

  await nick.fill('..');
  await expect(status).toContainText('al menos 3 caracteres');
  await expect(nick).toHaveAttribute('aria-invalid', 'true');
  await expect(start).toBeDisabled();
  await expect(captcha).toBeHidden();

  await fillAndWaitForLookup(page, '../..');
  await expect(status).toContainText('no se permiten rutas');
  await expect(start).toBeDisabled();
  await expect(captcha).toBeHidden();

  await fillAndWaitForLookup(page, 'admin');
  await expect(status).toHaveText('Este nick está reservado.');
  await expect(start).toBeDisabled();
  await expect(captcha).toBeHidden();

  await fillAndWaitForLookup(page, 'pedofilo');
  await expect(status).toContainText('lenguaje ofensivo');
  await expect(start).toBeDisabled();
  await expect(captcha).toBeHidden();

  await fillAndWaitForLookup(page, 'Jugador106');
  await expect(nick).toHaveAttribute('aria-invalid', 'false');
  await expect(captcha).toBeVisible();
  await expect(status).toContainText('intentos globales disponibles');
  expect(errors).toEqual([]);
});

test('ranking and direct profile routes keep traversal-shaped nicknames inside the application', async ({ page }) => {
  await installRuntime(page);
  const errors = trackRuntimeErrors(page);

  await page.goto('/ranking.html');
  const search = page.locator('#rankingSearch');
  await search.fill('../..');
  await page.locator('#rankingSearchButton').click();
  await expect(page).toHaveURL(/\/ranking\.html$/);
  await expect(search).toHaveAttribute('aria-invalid', 'true');
  await expect(search).toBeFocused();

  await page.goto('/player.html?nick=..%2F..');
  await expect(page).toHaveURL(/\/player\.html\?nick=\.\.%2F\.\.$/i);
  await expect(page.locator('#playerError')).toBeVisible();
  await expect(page.locator('#playerErrorMessage')).toHaveText('La ruta del jugador no es válida.');
  expect(errors).toEqual([]);
});
