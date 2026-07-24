import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path) => readFileSync(path, 'utf8');

describe('home statistics synchronization', () => {
  it('loads the coordinator after number formatting and before every home data consumer', () => {
    const html = read('public/index.html');
    const format = html.indexOf('./format.js');
    const coordinator = html.indexOf('./home-stats.js?v=20260724');
    const app = html.indexOf('./app.js');
    const legacyAwards = html.indexOf('./v3.js');
    const fallbackRanking = html.indexOf('./v4.js');
    const competition = html.indexOf('./competition.js');

    expect(format).toBeGreaterThan(-1);
    expect(coordinator).toBeGreaterThan(format);
    expect(coordinator).toBeLessThan(app);
    expect(coordinator).toBeLessThan(legacyAwards);
    expect(coordinator).toBeLessThan(fallbackRanking);
    expect(coordinator).toBeLessThan(competition);
  });

  it('deduplicates concurrent stats requests and expires the shared response', () => {
    const script = read('public/home-stats.js');
    expect(script).toContain("requestAction(init) === 'stats'");
    expect(script).toContain('if (!cachedStatsResponse) cachedStatsResponse = createCachedStatsResponse(input, init)');
    expect(script).toContain('return response.clone();');
    expect(script).toContain('window.setTimeout(clearCachedStatsResponse, CACHE_RETENTION_MS)');
    expect(script).toContain('clearCachedStatsResponse();');
  });

  it('commits one complete ranking surface after legacy renderers settle', () => {
    const script = read('public/home-stats.js');
    expect(script).toContain("row.dataset.homeRankingReady = 'true'");
    expect(script).toContain("time.className = 'ranking-time'");
    expect(script).toContain("flag.setAttribute('role', 'img')");
    expect(script).toContain("flag.setAttribute('aria-label', team.name)");
    expect(script).toContain("list.dataset.renderState = 'ready'");
    expect(script).toContain('window.requestAnimationFrame(() => {');
    expect(script.match(/window\.requestAnimationFrame\(\(\) => \{/g)).toHaveLength(2);
  });

  it('keeps scores compact while preserving their full accessible value', () => {
    const script = read('public/home-stats.js');
    const format = read('public/format.js');
    expect(script).toContain("setCompactValue('#spainScore', spainScore)");
    expect(script).toContain("setCompactValue('#argentinaScore', argentinaScore)");
    expect(script).toContain('target.title = fullNumber(value)');
    expect(format).toContain("const units = ['', 'K', 'M', 'B', 'T']");
  });
});
