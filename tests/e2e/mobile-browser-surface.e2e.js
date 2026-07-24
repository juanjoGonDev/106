import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const runtimePath = process.env.PLAYWRIGHT_TEST_PATH;
if (!runtimePath) throw new Error('PLAYWRIGHT_TEST_PATH is required. Run Playwright through pnpm test:e2e.');
const require = createRequire(import.meta.url);
const { expect, test } = require(runtimePath);

const APP_THEME_COLOR = '#2b0d28';
const APP_VIEWPORT_CONTENT = 'width=device-width,initial-scale=1,viewport-fit=cover';
const visualCapture = process.env.PR_VISUAL_CAPTURE === '1';
const previewRoot = resolve('.tmp/pr-previews');

function projectDevice(testInfo) {
  return testInfo.project.name.includes('mobile') ? 'mobile' : 'desktop';
}

test('uses app-like browser chrome without disabling pinch zoom', async ({ page }, testInfo) => {
  await page.goto('/');

  await expect.poll(() => page.locator('meta[name="viewport"]').getAttribute('content')).toBe(APP_VIEWPORT_CONTENT);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', APP_THEME_COLOR);
  await expect(page.locator('link[data-minuto106-browser-surface]')).toHaveAttribute('href', './browser-surface.css');

  const browserSurface = await page.evaluate(() => ({
    touchAction: getComputedStyle(document.body).touchAction,
    viewport: document.querySelector('meta[name="viewport"]')?.content || '',
  }));

  expect(browserSurface.touchAction).toBe('manipulation');
  expect(browserSurface.viewport).not.toContain('user-scalable=no');
  expect(browserSurface.viewport).not.toContain('maximum-scale=1');

  if (visualCapture) {
    mkdirSync(previewRoot, { recursive: true });
    await page.screenshot({
      path: resolve(previewRoot, `browser-surface-${projectDevice(testInfo)}.png`),
      animations: 'disabled',
      fullPage: true,
    });
  }
});
