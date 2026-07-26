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

const staticPages = Object.freeze([
  { id: 'legal-page', path: '/legal.html' },
  { id: 'privacy-page', path: '/privacidad.html' },
  { id: 'cookies-page', path: '/cookies.html' },
]);

function deviceName(testInfo) {
  return testInfo.project.name.includes('mobile') ? 'mobile' : 'desktop';
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
