import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const APP_THEME_COLOR = '#2b0d28';
const APP_VIEWPORT_CONTENT = 'width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover';
const bootstrappedPages = [
  'public/index.html',
  'public/ranking.html',
  'public/ligas.html',
  'public/cuenta.html',
  'public/cookies.html',
  'public/privacidad.html',
  'public/legal.html',
  'public/player.html',
];
const staticViewportPages = ['index.html', 'public/404.html'];

function read(path) {
  return readFileSync(path, 'utf8');
}

describe('mobile browser surface', () => {
  it.each(staticViewportPages)('disables browser zoom statically in %s', (path) => {
    const html = read(path);
    expect(html).toContain(`content="${APP_VIEWPORT_CONTENT}"`);
    expect(html).toContain('maximum-scale=1');
    expect(html).toContain('user-scalable=no');
  });

  it.each(bootstrappedPages)('loads the shared browser surface from %s', (path) => {
    expect(read(path)).toContain('<script src="./privacy-bootstrap.js"></script>');
  });

  it('normalizes the restrictive viewport and browser chrome from the shared head bootstrap', () => {
    const bootstrap = read('public/privacy-bootstrap.js');
    expect(bootstrap).toContain(`const APP_THEME_COLOR = '${APP_THEME_COLOR}'`);
    expect(bootstrap).toContain(`const APP_VIEWPORT_CONTENT = '${APP_VIEWPORT_CONTENT}'`);
    expect(bootstrap).toContain("stylesheet.href = './browser-surface.css'");
    expect(bootstrap).toContain("observer.observe(document.head, { childList: true, subtree: true })");
    expect(bootstrap).toContain('applyBrowserMetadata(true)');
  });

  it('installs the ios multi-touch and gesture zoom fallback', () => {
    const bootstrap = read('public/privacy-bootstrap.js');
    expect(bootstrap).toContain("document.addEventListener('touchmove', preventMultiTouchZoom, { passive: false })");
    expect(bootstrap).toContain("['gesturestart', 'gesturechange', 'gestureend']");
    expect(bootstrap).toContain('if (event.touches.length > 1) event.preventDefault()');
    expect(bootstrap).toContain('document.addEventListener(eventName, preventGestureZoom, { passive: false })');
  });

  it('excludes pinch zoom while protecting device safe areas', () => {
    const styles = read('public/browser-surface.css');
    expect(styles).toContain('touch-action: pan-x pan-y;');
    expect(styles).toContain('env(safe-area-inset-top, 0px)');
    expect(styles).toContain('env(safe-area-inset-right, 0px)');
    expect(styles).toContain('env(safe-area-inset-bottom, 0px)');
    expect(styles).toContain('env(safe-area-inset-left, 0px)');
    expect(styles).not.toContain('touch-action: manipulation');
    expect(styles).not.toContain('pinch-zoom');
  });

  it('keeps the browser tint and standalone manifest behavior', () => {
    for (const path of ['index.html', 'public/404.html']) {
      const html = read(path);
      expect(html).toContain(`name="theme-color" content="${APP_THEME_COLOR}"`);
    }

    const manifest = JSON.parse(read('public/site.webmanifest'));
    expect(manifest.theme_color).toBe(APP_THEME_COLOR);
    expect(manifest.background_color).toBe('#08090c');
    expect(manifest.display).toBe('standalone');
  });
});
