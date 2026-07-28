import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const layout = readFileSync('public/layout.js', 'utf8');

describe('shared layout enhancement loading', () => {
  it('loads honours and compliance through one observable asynchronous boundary', () => {
    expect(layout).toContain("import('./honours.js')");
    expect(layout).toContain("import('./compliance.js')");
    expect(layout).toContain('window.Minuto106EnhancementsReady = ready');
    expect(layout).toContain("dataset.minuto106Enhancements = 'ready'");
    expect(layout).toContain("dataset.minuto106Enhancements = 'failed'");
  });

  it('does not inject blocking classic enhancement scripts', () => {
    expect(layout).not.toContain('ensureClassicScript');
    expect(layout).not.toContain("script.async = false");
    expect(layout).not.toContain("script.src = './honours.js'");
    expect(layout).not.toContain("script.src = './compliance.js'");
  });

  it('builds shared DOM before starting the enhancement promise', () => {
    const privacy = layout.lastIndexOf('renderPrivacyComponents();');
    const chrome = layout.lastIndexOf('renderSiteChrome();');
    const dialogs = layout.lastIndexOf('enhanceDialogs();');
    const columns = layout.lastIndexOf('buildGameColumns();');
    const enhancements = layout.lastIndexOf('void loadSharedEnhancements();');
    expect(privacy).toBeGreaterThan(-1);
    expect(privacy).toBeLessThan(chrome);
    expect(chrome).toBeLessThan(dialogs);
    expect(dialogs).toBeLessThan(columns);
    expect(columns).toBeLessThan(enhancements);
  });
});
