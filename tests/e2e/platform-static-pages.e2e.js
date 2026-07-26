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
mkdirSync(previewDirectory, { recursive: true });

const staticPages = Object.freeze([
  { id: 'legal-page', path: '/legal.html' },
  { id: 'privacy-page', path: '/privacidad.html' },
  { id: 'cookies-page', path: '/cookies.html' },
]);

function deviceName(testInfo) {
  return testInfo.project.name.includes('mobile') ? 'mobile' : 'desktop';
}

function evidenceName(area, isMobile) {
  return `${area}-${isMobile ? 'mobile' : 'desktop'}`;
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

async function expectResponsivePage(page) {
  await expect(page.locator('body')).toBeVisible();
  await expect(page.locator('.site-header')).toBeVisible();
  await expect(page.locator('.site-footer')).toBeVisible();
  const overflow = await page.evaluate(() => ({
    content: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(overflow.content).toBeLessThanOrEqual(overflow.viewport + 1);
}

async function capture(page, id, testInfo) {
  if (!captureEvidence) return;
  await page.screenshot({
    path: join(previewDirectory, `${id}-${deviceName(testInfo)}.png`),
    animations: 'disabled',
    fullPage: true,
  });
}

async function saveVideo(context, page, area, isMobile) {
  const video = page.video();
  if (!video) throw new Error(`Playwright did not create the ${area} recording.`);
  await context.close();
  await video.saveAs(join(previewDirectory, `${evidenceName(area, isMobile)}.webm`));
}

for (const pageDefinition of staticPages) {
  test(`captures the complete ${pageDefinition.id} surface`, async ({ page }, testInfo) => {
    await page.goto(pageDefinition.path);
    await expectResponsivePage(page);
    await capture(page, pageDefinition.id, testInfo);
  });
}

test('captures the privacy settings dialog from the real application shell', async ({ page }, testInfo) => {
  await page.route('**/functions/v1/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.goto('/');
  await expectResponsivePage(page);
  await expect(page.locator('#privacyChip')).toBeVisible();
  await page.locator('#openCookieSettings').click();
  await expect(page.locator('#cookieDialog')).toBeVisible();
  await capture(page, 'privacy-settings', testInfo);
});

test('records the complete responsive cookies page journey', async ({ browser, isMobile }) => {
  test.skip(!captureEvidence, 'Visual recording is generated only by the PR evidence workflow.');
  const context = await browser.newContext(recordingContextOptions(isMobile));
  const page = await context.newPage();
  await page.goto('/cookies.html');
  await expectResponsivePage(page);
  await page.waitForTimeout(500);
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' }));
  await page.waitForTimeout(1_200);
  await expect(page.locator('.site-footer')).toBeInViewport();
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  await page.waitForTimeout(900);
  await saveVideo(context, page, 'cookies-page', isMobile);
});
