import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  calculateCenteredScrollTop,
  installGameplayViewportController,
} from '../public/game-viewport.js';

const html = readFileSync('public/index.html', 'utf8');
const styles = readFileSync('public/v10.css', 'utf8');
const source = readFileSync('public/game-viewport.js', 'utf8');

const viewportMatrix = [
  ['compact Android portrait', 320, 568, 0],
  ['small Android portrait', 360, 640, 0],
  ['compact iPhone portrait', 375, 667, 0],
  ['modern iPhone portrait', 390, 844, 0],
  ['large Android portrait', 412, 915, 0],
  ['phone landscape', 844, 390, 12],
  ['tablet portrait', 768, 1024, 0],
  ['tablet landscape', 1024, 768, 0],
  ['desktop', 1440, 900, 0],
];

describe('mobile gameplay viewport positioning', () => {
  it.each(viewportMatrix)('centers the timer in %s (%d×%d)', (_name, _width, height, offsetTop) => {
    const elementDocumentTop = 920;
    const elementHeight = Math.min(190, Math.round(height * 0.32));
    const currentScrollY = 1_640;
    const target = calculateCenteredScrollTop({
      elementTop: elementDocumentTop - currentScrollY,
      elementHeight,
      scrollY: currentScrollY,
      viewportOffsetTop: offsetTop,
      viewportHeight: height,
      maxScrollY: 3_200,
    });
    const centeredPosition = elementDocumentTop + elementHeight / 2 - target - offsetTop;

    expect(centeredPosition).toBeCloseTo(height / 2, 5);
  });

  it('clamps centering at the top and bottom document boundaries', () => {
    expect(calculateCenteredScrollTop({
      elementTop: -40,
      elementHeight: 80,
      scrollY: 0,
      viewportOffsetTop: 0,
      viewportHeight: 640,
      maxScrollY: 2_000,
    })).toBe(0);

    expect(calculateCenteredScrollTop({
      elementTop: 900,
      elementHeight: 160,
      scrollY: 1_900,
      viewportOffsetTop: 0,
      viewportHeight: 640,
      maxScrollY: 2_000,
    })).toBe(2_000);
  });

  it('centers synchronously on activation and verifies the position for two frames', () => {
    const animationFrames = [];
    const scrollTo = vi.fn();
    const focus = vi.fn();
    let observerCallback;
    const playingPanel = {
      classList: { contains: vi.fn(() => true) },
      focus,
    };
    const timerStage = {
      getBoundingClientRect: vi.fn(() => ({ top: -520, height: 180 })),
    };
    const gameCard = {};
    const documentRef = {
      documentElement: { clientHeight: 640, scrollHeight: 3_000 },
      querySelector: vi.fn((selector) => ({
        '.game-card': gameCard,
        '#playing': playingPanel,
        '#playing .timer-stage': timerStage,
      })[selector]),
    };
    class FakeMutationObserver {
      constructor(callback) { observerCallback = callback; }
      observe = vi.fn();
      disconnect = vi.fn();
    }
    const windowRef = {
      MutationObserver: FakeMutationObserver,
      visualViewport: { height: 620, offsetTop: 10 },
      scrollY: 1_500,
      innerHeight: 640,
      scrollTo,
      requestAnimationFrame: vi.fn((callback) => { animationFrames.push(callback); }),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    installGameplayViewportController(documentRef, windowRef);
    observerCallback();

    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: 'auto' }));
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(animationFrames).toHaveLength(1);

    animationFrames.shift()();
    expect(scrollTo).toHaveBeenCalledTimes(2);
    expect(animationFrames).toHaveLength(1);

    animationFrames.shift()();
    expect(scrollTo).toHaveBeenCalledTimes(3);
    expect(animationFrames).toHaveLength(0);
  });

  it('loads the controller before the game module and exposes an accessible playing region', () => {
    expect(html).toContain('<link rel="stylesheet" href="./v9.css">');
    expect(html).toContain('<link rel="stylesheet" href="./v10.css">');
    expect(html.indexOf('./game-viewport.js')).toBeLessThan(html.indexOf('./app.js'));
    expect(html).toContain('id="playing" class="panel" role="region" aria-labelledby="playInstruction" tabindex="-1"');
    expect(source).toContain('new windowRef.MutationObserver');
    expect(source).toContain("behavior: 'auto'");
    expect(source).not.toContain("behavior: 'smooth'");
  });

  it('keeps inactive panels out of layout and stabilizes captcha action rows', () => {
    expect(styles).toContain('.game-card > .panel:not(.active)');
    expect(styles).toContain('display: none !important;');
    expect(styles).toMatch(/\.game-card\s*\{\s*min-height:\s*0;/);
    expect(styles).toMatch(/\.human-check-status,\s*\.human-check-continue\s*\{[^}]*grid-row:\s*4;/s);
    expect(styles).toContain('@media (max-height: 540px)');
    expect(styles).toContain('100dvh');
  });

  it('replaces key controls on the game page with one descriptive profile link', () => {
    const panel = html.match(/<p id="playerAccessPanel"[\s\S]*?<\/p>/)?.[0] || '';
    expect(panel).toContain('<a href="./cuenta.html">');
    expect(panel).toContain('Abrir mi perfil');
    expect(panel).toContain('id="playerAccessStatus"');
    expect(panel).not.toContain('<button');
    expect(panel).not.toContain('<input');
    expect(html).not.toContain('id="copyPlayerKeyButton"');
    expect(html).not.toContain('id="importPlayerKeyButton"');
    expect(html).not.toContain('id="playerKeyInput"');
  });
});
