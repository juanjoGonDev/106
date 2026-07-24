import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const runtimePath = process.env.PLAYWRIGHT_TEST_PATH;
if (!runtimePath) throw new Error('PLAYWRIGHT_TEST_PATH is required. Run Playwright through pnpm test:e2e.');
const require = createRequire(import.meta.url);
const { expect, test } = require(runtimePath);

const APP_THEME_COLOR = '#2b0d28';
const APP_VIEWPORT_CONTENT = 'width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover';
const visualCapture = process.env.PR_VISUAL_CAPTURE === '1';
const previewRoot = resolve('.tmp/pr-previews');

function projectDevice(testInfo) {
  return testInfo.project.name.includes('mobile') ? 'mobile' : 'desktop';
}

test('blocks mobile page zoom and keeps app browser chrome', async ({ page, context }, testInfo) => {
  await page.goto('/');

  await expect.poll(() => page.locator('meta[name="viewport"]').getAttribute('content')).toBe(APP_VIEWPORT_CONTENT);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', APP_THEME_COLOR);
  await expect(page.locator('link[data-minuto106-browser-surface]')).toHaveAttribute('href', './browser-surface.css');

  const browserSurface = await page.evaluate(() => ({
    scale: globalThis.visualViewport?.scale ?? 1,
    touchAction: getComputedStyle(document.body).touchAction,
    viewport: document.querySelector('meta[name="viewport"]')?.content || '',
  }));

  expect(browserSurface.scale).toBe(1);
  expect(browserSurface.touchAction).toBe('pan-x pan-y');
  expect(browserSurface.viewport).toContain('maximum-scale=1');
  expect(browserSurface.viewport).toContain('user-scalable=no');

  if (testInfo.project.name.includes('mobile')) {
    const viewport = page.viewportSize();
    if (!viewport) throw new Error('Mobile viewport is required for pinch regression coverage.');
    const client = await context.newCDPSession(page);
    await client.send('Input.synthesizePinchGesture', {
      x: Math.round(viewport.width / 2),
      y: Math.round(viewport.height / 2),
      scaleFactor: 2,
      relativeSpeed: 800,
      gestureSourceType: 'touch',
    });
    await expect.poll(() => page.evaluate(() => globalThis.visualViewport?.scale ?? 1)).toBe(1);
    await client.detach();
  }

  if (visualCapture) {
    mkdirSync(previewRoot, { recursive: true });
    await page.screenshot({
      path: resolve(previewRoot, `browser-surface-${projectDevice(testInfo)}.png`),
      animations: 'disabled',
      fullPage: true,
    });
  }
});
