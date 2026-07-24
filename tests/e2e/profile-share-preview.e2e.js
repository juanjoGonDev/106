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

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X1fA9QAAAABJRU5ErkJggg==', 'base64');

async function installNativeShare(page, supportsFiles) {
  await page.addInitScript((fileSupport) => {
    Object.defineProperty(Navigator.prototype, 'canShare', {
      configurable: true,
      value: (payload) => fileSupport && Array.isArray(payload.files) && payload.files.length === 1,
    });
    Object.defineProperty(Navigator.prototype, 'share', {
      configurable: true,
      value: async (payload) => {
        globalThis.__profileSharePayload = {
          title: payload.title,
          text: payload.text,
          url: payload.url,
          files: Array.from(payload.files || [], (file) => ({ name: file.name, type: file.type, size: file.size })),
        };
      },
    });
  }, supportsFiles);
}

async function installProfileApi(page) {
  await page.route('**/functions/v1/game-api', async (route) => {
    const body = route.request().postDataJSON() || {};
    if (body.action === 'public-profile') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(profile) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

test('shares the current profile PNG with text and the unchanged public URL', async ({ page }) => {
  let releaseCard;
  const cardAllowed = new Promise((resolve) => { releaseCard = resolve; });

  await installNativeShare(page, true);
  await installProfileApi(page);
  await page.route('**/functions/v1/player-share/**', async (route) => {
    await cardAllowed;
    await route.fulfill({ status: 200, contentType: 'image/png', body: png });
  });

  await page.goto('/player.html?nick=Yisucrist', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1, name: 'Yisucrist' })).toBeVisible();
  await expect(page).toHaveURL(/\/player\/Yisucrist$/);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /player-share\/Yisucrist\/card\.png\?v=321$/);

  const shareButton = page.getByRole('button', { name: 'Preparando...' });
  await expect(shareButton).toBeDisabled();
  releaseCard();
  await expect(page.getByRole('button', { name: 'Compartir perfil' })).toBeEnabled();

  await page.getByRole('button', { name: 'Compartir perfil' }).click();
  await expect.poll(() => page.evaluate(() => globalThis.__profileSharePayload ?? null)).not.toBeNull();
  const payload = await page.evaluate(() => globalThis.__profileSharePayload);

  expect(payload.url).toBeUndefined();
  expect(payload.text).toContain('Yisucrist suma 2 trofeos, 1 logro y 10 puntos.');
  expect(payload.text).toContain('http://127.0.0.1:3000/player/Yisucrist');
  expect(payload.text).not.toContain('supabase.co');
  expect(payload.text).not.toContain('/functions/');
  expect(payload.files).toEqual([{
    name: 'minuto-106-yisucrist-overview.png',
    type: 'image/png',
    size: png.length,
  }]);
});

test('falls back to native text and URL sharing when the browser cannot share files', async ({ page }) => {
  await installNativeShare(page, false);
  await installProfileApi(page);
  await page.route('**/functions/v1/player-share/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'image/png', body: png });
  });

  await page.goto('/player.html?nick=Yisucrist');
  const shareButton = page.getByRole('button', { name: 'Compartir perfil' });
  await expect(shareButton).toBeEnabled();
  await shareButton.click();
  await expect.poll(() => page.evaluate(() => globalThis.__profileSharePayload ?? null)).not.toBeNull();
  const payload = await page.evaluate(() => globalThis.__profileSharePayload);

  expect(payload.files).toEqual([]);
  expect(payload.text).toBe('Yisucrist suma 2 trofeos, 1 logro y 10 puntos.');
  expect(payload.url).toBe('http://127.0.0.1:3000/player/Yisucrist');
});
