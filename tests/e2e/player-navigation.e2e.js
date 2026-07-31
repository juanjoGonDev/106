import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

import { PLAYER_CARD_RENDERER_REVISION } from '../../shared/player-radar-model.js';

const runtimePath = process.env.PLAYWRIGHT_TEST_PATH;
if (!runtimePath) throw new Error('PLAYWRIGHT_TEST_PATH is required. Run Playwright through pnpm test:e2e.');
const require = createRequire(import.meta.url);
const { devices, expect, test } = require(runtimePath);
const visualCapture = process.env.PR_VISUAL_CAPTURE === '1';
const previewDirectory = resolve('.tmp/pr-previews');
const applicationUrl = 'http://127.0.0.1:3000';
mkdirSync(previewDirectory, { recursive: true });

function profile() {
  return {
    nick: 'Javiererd90',
    team: 'spain',
    profileRevision: 31,
    attemptsUsed: 0,
    lifetimeAttemptsUsed: 5,
    verifiedAttempts: 5,
    averageDifferenceMs: 351,
    bestDifferenceMs: 3,
    globalRankBest: 1,
    completedReferrals: 0,
    bonusAttempts: 0,
    trophies: { total: 2, days: 1, goldenBoot: 1, goldenGlove: 1, goldenBall: 0, leagueChampion: 0, history: [] },
    achievements: { total: 7, points: 155, items: [], featured: [] },
    honoursProgress: { today: {} },
    history: [],
  };
}

function cardFixtureSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <rect width="1200" height="630" rx="32" fill="#090d15"/>
    <rect x="36" y="36" width="670" height="558" rx="28" fill="#111722"/>
    <rect x="738" y="36" width="426" height="558" rx="28" fill="#0d131d"/>
    <text x="72" y="92" fill="#f4c95d" font-family="Arial" font-size="20" font-weight="700">MINUTO 106 · PERFIL GLOBAL</text>
    <text x="72" y="156" fill="#ffffff" font-family="Arial" font-size="54" font-weight="800">Javiererd90</text>
    <text x="72" y="220" fill="#d4d7df" font-family="Arial" font-size="24">España · #1 GLOBAL</text>
    <text x="72" y="310" fill="#ffffff" font-family="Arial" font-size="22">MEJOR ±3 ms · MEDIA ±351 ms · 5 VÁLIDOS</text>
    <text x="951" y="82" text-anchor="middle" fill="#f4c95d" font-family="Arial" font-size="18" font-weight="700">PENTÁGONO</text>
    <polygon points="951,126 1090,227 1037,391 865,391 812,227" fill="none" stroke="#343a46" stroke-width="3"/>
    <polygon points="951,126 1058,246 973,301 865,391 951,292" fill="rgba(244,201,93,.28)" stroke="#f4c95d" stroke-width="5"/>
    <text x="951" y="456" text-anchor="middle" fill="#ffffff" font-family="Arial" font-size="22" font-weight="700">100 · 77 · 25 · 100 · 0</text>
    <text x="951" y="500" text-anchor="middle" fill="#d4d7df" font-family="Arial" font-size="18">Mismo cálculo que el perfil web</text>
  </svg>`;
}

function evidenceDevice(isMobile) {
  return isMobile ? 'mobile' : 'desktop';
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
  };
}

async function installMocks(page) {
  await page.route('**/functions/v1/player-share/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: cardFixtureSvg() });
  });
  await page.route('**/functions/v1/player-context', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ availability: 'occupied', profile: profile(), leagues: [] }),
    });
  });
}

async function expectVersionedCardPreview(page) {
  const preview = page.locator('#playerCardPreview');
  await expect(preview).toBeVisible();
  await expect(preview).toHaveJSProperty('complete', true);
  const source = await preview.getAttribute('src');
  expect(source).toBeTruthy();
  const url = new URL(source, page.url());
  expect(url.pathname).toMatch(/\/functions\/v1\/player-share\/Javiererd90\/achievements\.png$/);
  expect(url.searchParams.get('v')).toBe('31');
  expect(url.searchParams.get('r')).toBe(String(PLAYER_CARD_RENDERER_REVISION));
}

async function capture(page, testInfo) {
  if (!visualCapture) return;
  const device = testInfo.project.name.includes('mobile') ? 'mobile' : 'desktop';
  await page.screenshot({ path: resolve(previewDirectory, `player-navigation-${device}.png`), animations: 'disabled', fullPage: true });
}

async function saveVideo(context, page, area, isMobile) {
  const video = page.video();
  if (!video) throw new Error(`Playwright did not create the ${area} recording.`);
  await context.close();
  await video.saveAs(join(previewDirectory, `${area}-${evidenceDevice(isMobile)}.webm`));
}

test('player clean routes keep the web radar and generated card in sync', async ({ page }, testInfo) => {
  await installMocks(page);
  const pageErrors = [];
  const consoleErrors = [];
  const failedRequests = [];
  const cleanRouteAssetLeaks = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('requestfailed', (request) => failedRequests.push(`${request.method()} ${request.url()}`));
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith('/player/assets/') || pathname === '/player/share-actions.js') {
      cleanRouteAssetLeaks.push(pathname);
    }
  });

  await page.goto('/player/Javiererd90');
  await expect(page.getByRole('heading', { level: 1, name: 'Javiererd90' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 3, name: 'Cómo se calcula cada estadística' })).toBeVisible();
  await expectVersionedCardPreview(page);

  const explanations = page.locator('#playerRadarExplanations details');
  await expect(explanations).toHaveCount(5);
  for (const [key, label, score] of [
    ['precision', 'Precisión', '100/100'],
    ['consistency', 'Regularidad', '77/100'],
    ['experience', 'Experiencia', '25/100'],
    ['reliability', 'Fiabilidad', '100/100'],
    ['impact', 'Impacto', '0/100'],
  ]) {
    const explanation = page.locator(`details[data-stat-key="${key}"]`);
    await expect(explanation.locator('summary')).toContainText(label);
    await expect(explanation.locator('summary')).toContainText(score);
  }

  const precision = page.locator('details[data-stat-key="precision"]');
  await precision.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(precision).toHaveAttribute('open', '');
  await expect(precision).toContainText('Solo mejora cuando superas tu mejor diferencia.');
  await page.keyboard.press('Enter');
  await expect(precision).not.toHaveAttribute('open', '');

  const reliability = page.locator('details[data-stat-key="reliability"]');
  await reliability.locator('summary').click();
  await expect(reliability).toHaveAttribute('open', '');
  await expect(reliability).toContainText('5 intentos válidos de 5 intentos históricos.');
  await expect(reliability).toContainText('El reinicio diario no borra el historial usado por esta estadística.');

  const impact = page.locator('details[data-stat-key="impact"]');
  await impact.locator('summary').click();
  await expect(impact).toHaveAttribute('open', '');
  await expect(impact).toContainText('Cada referido completado suma 20 puntos y cada intento diario adicional suma 8');

  const brand = page.locator('.site-header .brand');
  const firstNavigationLink = page.locator('.site-navigation a').first();
  const brandHref = await brand.getAttribute('href');
  const firstNavigationHref = await firstNavigationLink.getAttribute('href');

  expect(new URL(brandHref, page.url()).pathname).toBe('/');
  expect(new URL(firstNavigationHref, page.url()).pathname).toBe('/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  expect(cleanRouteAssetLeaks).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
  await capture(page, testInfo);

  await brand.click();
  await expect(page).toHaveURL((url) => url.pathname === '/');
});

test('records the corrected radar and refreshed card preview together', async ({ browser, isMobile }) => {
  test.skip(!visualCapture, 'Visual recording is generated only by the PR evidence workflow.');
  const context = await browser.newContext(recordingContextOptions(isMobile));
  const page = await context.newPage();
  await installMocks(page);

  await page.goto('/player/Javiererd90');
  await expect(page.getByRole('heading', { level: 1, name: 'Javiererd90' })).toBeVisible();
  await expectVersionedCardPreview(page);
  const reliability = page.locator('details[data-stat-key="reliability"]');
  const summary = reliability.locator('summary');
  await summary.scrollIntoViewIfNeeded();

  await page.waitForTimeout(400);
  await summary.click();
  await expect(reliability).toHaveAttribute('open', '');
  await expect(reliability).toContainText('5 intentos válidos de 5 intentos históricos.');
  await page.waitForTimeout(900);
  await page.locator('#playerCardPreview').scrollIntoViewIfNeeded();
  await page.waitForTimeout(700);
  await summary.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);

  const device = evidenceDevice(isMobile);
  await page.screenshot({
    path: join(previewDirectory, `player-reliability-${device}.png`),
    animations: 'disabled',
    fullPage: true,
  });
  await saveVideo(context, page, 'player-reliability', isMobile);
});
