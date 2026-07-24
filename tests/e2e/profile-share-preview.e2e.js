import { createRequire } from 'node:module';

const runtimePath = process.env.PLAYWRIGHT_TEST_PATH;
if (!runtimePath) throw new Error('PLAYWRIGHT_TEST_PATH is required. Run Playwright through pnpm test:e2e.');
const require = createRequire(import.meta.url);
const { expect, test } = require(runtimePath);

const profile = {
  nick: 'Yisucrist',
  team: 'spain',
  profileRevision: 321,
  verifiedAttempts: 5,
  averageDifferenceMs: 240,
  bestDifferenceMs: 6,
  globalRankBest: 2,
  trophies: {
    total: 2,
    days: 2,
    leagueChampion: 0,
    history: [],
  },
  achievements: {
    total: 1,
    points: 10,
    items: [],
  },
  history: [],
};

async function installMocks(page) {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'share', {
      configurable: true,
      value: async (payload) => {
        globalThis.__profileSharePayload = payload;
      },
    });
  });

  await page.route('**/functions/v1/player-share/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="1200" height="630" fill="#08090c"/></svg>',
    });
  });

  await page.route('**/functions/v1/game-api', async (route) => {
    const body = route.request().postDataJSON() || {};
    if (body.action === 'public-profile') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(profile) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

test('profile sharing uses a 200 document with crawler-visible image metadata', async ({ page, request }) => {
  const cleanRoute = await request.get('/player/Yisucrist');
  expect(cleanRoute.status()).toBe(404);

  const shareDocument = await request.get('/player.html?nick=Yisucrist');
  expect(shareDocument.status()).toBe(200);
  const html = await shareDocument.text();
  expect(html).toContain('property="og:image"');
  expect(html).toContain('property="og:image:secure_url"');
  expect(html).toContain('name="twitter:card" content="summary_large_image"');
  expect(html).toContain('name="twitter:image"');
  expect(html).toContain('name="twitter:image:src"');
  expect(html).toContain('/assets/minuto-106-social-preview.jpg');

  await installMocks(page);
  await page.goto('/player.html?nick=Yisucrist');
  await expect(page.getByRole('heading', { level: 1, name: 'Yisucrist' })).toBeVisible();
  await expect(page).toHaveURL(/\/player\.html\?nick=Yisucrist$/);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /player-share\/Yisucrist\/card\.png\?v=321$/);

  await page.getByRole('button', { name: 'Compartir perfil' }).click();
  await expect.poll(() => page.evaluate(() => globalThis.__profileSharePayload ?? null)).not.toBeNull();
  const payload = await page.evaluate(() => globalThis.__profileSharePayload);
  const sharedUrl = new URL(payload.url);

  expect(sharedUrl.hostname).toBe('127.0.0.1');
  expect(sharedUrl.pathname).toBe('/player.html');
  expect(sharedUrl.searchParams.get('nick')).toBe('Yisucrist');
  expect(payload.url).not.toContain('supabase.co');
  expect(payload.url).not.toContain('/functions/');
});
