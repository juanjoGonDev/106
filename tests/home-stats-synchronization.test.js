import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path) => readFileSync(path, 'utf8');

const statsConsumers = [
  'public/app.js',
  'public/v3.js',
  'public/v4.js',
  'public/competition.js',
  'public/ranking-enhancements.js',
];

describe('home statistics synchronization', () => {
  it('loads the authoritative store after formatting and before its subscribers', () => {
    const html = read('public/index.html');
    const format = html.indexOf('./format.js');
    const coordinator = html.indexOf('./home-stats.js?v=20260724');
    const awards = html.indexOf('./ranking-enhancements.js?v=20260802-awards-reset');

    expect(format).toBeGreaterThan(-1);
    expect(coordinator).toBeGreaterThan(format);
    expect(awards).toBeGreaterThan(coordinator);
    expect(html).toContain('<script type="module" src="./ranking-enhancements.js?v=20260802-awards-reset"></script>');
  });

  it('keeps the only stats request inside the authoritative store', () => {
    const store = read('public/home-stats.js');
    expect(store).toContain("body: JSON.stringify({ action: 'stats' })");
    expect(store).toContain('function load()');
    expect(store).toContain('if (loadPromise) return loadPromise;');
    expect(store).not.toContain('window.fetch =');
    expect(store).not.toContain('response.clone()');

    for (const path of statsConsumers) {
      const script = read(path);
      expect(script, path).not.toMatch(/request\(['"]stats['"]/);
      expect(script, path).not.toMatch(/action:\s*['"]stats['"]/);
    }
  });

  it('renders one complete ranking directly from the snapshot', () => {
    const store = read('public/home-stats.js');
    const density = read('public/home-ranking-density.js');
    expect(store).toContain("row.dataset.homeRankingReady = 'true'");
    expect(store).toContain("time.className = 'ranking-time'");
    expect(store).toContain("flag.setAttribute('role', 'img')");
    expect(store).toContain("flag.setAttribute('aria-label', team.name)");
    expect(store).toContain("list.dataset.renderState = 'ready'");
    expect(store).not.toContain('requestAnimationFrame');
    expect(density).not.toContain('MutationObserver');
    expect(density).not.toContain('ensureAnchor');
    expect(density).not.toContain('compactLeaderboard');
  });

  it('publishes completed attempts and competition context explicitly', () => {
    const app = read('public/app.js');
    const competition = read('public/competition.js');
    expect(app).toContain("window.Minuto106HomeStats?.commit(data.stats, 'finish')");
    expect(app).toContain('leagueCode: window.Minuto106Competition?.activeLeagueCode || undefined');
    expect(app).toContain('window.Minuto106Competition?.handleResult(data)');
    expect(competition).toContain('handleResult: renderLeagueResult');
    expect(competition).not.toContain('window.fetch =');
    expect(competition).not.toContain('originalFetch');
  });

  it('renders awards only from complete shared snapshots without profile lookups', () => {
    const store = read('public/home-stats.js');
    const awards = read('public/ranking-enhancements.js');
    const legacy = read('public/v3.js');
    expect(store).toContain("if (hasOwn(stats, 'awards') || !hasOwn(latestStats, 'awards')) return stats;");
    expect(store).toContain('return { ...stats, awards: latestStats.awards };');
    expect(awards).toContain("if (!stats || !Object.hasOwn(stats, 'awards')) return;");
    expect(awards).toContain('homeStats.subscribe(renderAwards)');
    expect(awards).not.toContain("request('stats')");
    expect(awards).not.toContain("request('public-profile'");
    expect(legacy).not.toContain('loadAwards');
    expect(legacy).not.toContain('formatAward');
  });

  it('uses the server reset instant and preserves award player teams', () => {
    const html = read('public/index.html');
    const awards = read('public/ranking-enhancements.js');
    const migration = read('supabase/migrations/20260802210500_awards_reset_countdown.sql');

    expect(html).toContain('id="awardsResetCountdown"');
    expect(html).toContain('00:00, hora de España');
    expect(html).toContain('<link rel="stylesheet" href="./v22.css">');
    expect(awards).toContain("from './daily-attempt-limit.js?v=20260802-derived-budget'");
    expect(awards).toContain('millisecondsUntilReset(latestResetAt)');
    expect(awards).toContain('formatDailyCountdown(remaining)');
    expect(awards).toContain('homeStats.load()');
    expect(awards).toContain('refreshAttemptedFor === resetAt');
    expect(awards).not.toContain('setHours(');
    expect(awards).not.toContain("timeZone: 'Europe/Madrid'");
    expect(migration).toContain("'resetAt', context.reset_at");
    expect(migration).toContain('public.game_server_reset_at(public.game_server_day(clock_timestamp()))');
    expect(migration).toContain('public.game_server_day(attempt.created_at) = context.award_date');
    expect(migration).toContain('latest_team as (');
    expect(migration).toContain("'team', team.team");
  });

  it('keeps scores compact while preserving their full accessible value', () => {
    const store = read('public/home-stats.js');
    const format = read('public/format.js');
    expect(store).toContain("setCompactValue('#spainScore', battle.spainScore)");
    expect(store).toContain("setCompactValue('#argentinaScore', battle.argentinaScore)");
    expect(store).toContain('target.title = fullNumber(value)');
    expect(format).toContain("const units = ['', 'K', 'M', 'B', 'T']");
  });
});
