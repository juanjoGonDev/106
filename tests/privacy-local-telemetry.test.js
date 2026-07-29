import { readFileSync } from 'node:fs';
import vm from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

const source = readFileSync('public/privacy-bootstrap.js', 'utf8');

function executePrivacyBootstrap(hostname) {
  const links = [];
  const scripts = [];
  const listeners = new Map();
  const firstScriptParent = { insertBefore: vi.fn((script) => scripts.push(script)) };
  const head = {
    append: vi.fn((element) => {
      if (element.tagName === 'LINK') links.push(element);
      if (element.tagName === 'SCRIPT') scripts.push(element);
    }),
    querySelector: vi.fn((selector) => selector.startsWith('meta')
      ? { content: '' }
      : null),
  };
  const document = {
    head,
    createElement: vi.fn((tagName) => ({ tagName: tagName.toUpperCase(), dataset: {} })),
    querySelector: vi.fn(() => null),
    getElementsByTagName: vi.fn(() => [{ parentNode: firstScriptParent }]),
    addEventListener: vi.fn((event, callback) => listeners.set(event, callback)),
  };
  const window = {
    location: { hostname },
    localStorage: { getItem: vi.fn(() => null) },
  };
  class MutationObserver {
    observe() {}
    disconnect() {}
  }

  vm.runInNewContext(source, {
    Date,
    JSON,
    Map,
    MutationObserver,
    Number,
    Object,
    Set,
    document,
    window,
  });

  return { document, firstScriptParent, links, listeners, scripts, window };
}

describe('privacy bootstrap telemetry boundary', () => {
  it.each(['localhost', '127.0.0.1'])('does not load production GTM on %s', (hostname) => {
    const result = executePrivacyBootstrap(hostname);
    expect(result.scripts).toEqual([]);
    expect(result.firstScriptParent.insertBefore).not.toHaveBeenCalled();
    expect(result.window.dataLayer).toHaveLength(2);
  });

  it('does not preload deferred enhancement scripts before window load', () => {
    const result = executePrivacyBootstrap('localhost');
    expect(result.links.filter((link) => link.rel === 'preload')).toEqual([]);
    expect(source).not.toContain('SHARED_SCRIPT_PRELOADS');
    expect(source).not.toContain('ensureSharedScriptPreloads');
  });

  it('keeps production Tag Manager loading unchanged', () => {
    const result = executePrivacyBootstrap('juanjogondev.github.io');
    expect(result.scripts).toHaveLength(1);
    expect(result.scripts[0]).toMatchObject({
      async: true,
      src: 'https://www.googletagmanager.com/gtm.js?id=GTM-NKZK4DC5',
      dataset: { minuto106Gtm: 'true' },
    });
  });
});
