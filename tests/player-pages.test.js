import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path) => readFileSync(path, 'utf8');

describe('player pages and ranking links', () => {
  it('loads the shared player contract before all ranking renderers', () => {
    const index = read('public/index.html');
    const ranking = read('public/ranking.html');
    expect(index.indexOf('./player-ui.js')).toBeLessThan(index.indexOf('./app.js'));
    expect(index).toContain('./attempt-refresh.js');
    expect(index).toContain('./ranking-enhancements.js');
    expect(index).not.toContain('./profile-overlay.js');
    expect(ranking.indexOf('./player-ui.js')).toBeLessThan(ranking.indexOf('./ranking.js'));
    expect(ranking).not.toContain('id="rankingProfile"');
  });

  it('renders real anchors and flags for precision, trophy and achievement rows', () => {
    const ranking = read('public/ranking.js');
    expect(ranking).toContain('playerUi.playerUrl(nick, section)');
    expect(ranking).toContain('playerUi.teamHtml(team)');
    expect(ranking).toContain("section: 'trophies'");
    expect(ranking).toContain("section: 'achievements'");
    expect(ranking).toContain('class="leaderboard-row-link"');
    expect(ranking).not.toContain('showProfile(');
  });

  it('provides clean overview, achievements and trophies player sections', () => {
    const html = read('public/player.html');
    const script = read('public/player.js');
    const fallback = read('public/404.html');
    expect(html).toContain('data-player-section="overview"');
    expect(html).toContain('data-player-section="achievements"');
    expect(html).toContain('data-player-section="trophies"');
    expect(script).toContain('ui.playerUrl(player.nick, section)');
    expect(script).toContain('history.replaceState');
    expect(script).toContain('ui.cardUrl(apiUrl, player.nick, route.section)');
    expect(fallback).toContain('(?:player)\\/([^/]+)');
    expect(fallback).toContain('player.html');
  });

  it('separates achievement descriptions and dates into semantic elements', () => {
    const honours = read('public/honours.js');
    const player = read('public/player.js');
    const styles = read('public/v11.css');
    expect(honours).toContain('<time datetime=');
    expect(player).toContain('<time datetime=');
    expect(styles).toContain('.honours-list time');
    expect(styles).toContain('.player-list__copy time');
  });

  it('audits pointer cursors for anchors and enabled controls globally', () => {
    const styles = read('public/v11.css');
    const honours = read('public/honours.js');
    expect(styles).toContain('a[href],button:not(:disabled)');
    expect(styles).toContain('[role="button"]:not([aria-disabled="true"])');
    expect(honours).toContain("stylesheet.href = './v11.css'");
  });
});

describe('dynamic player social card', () => {
  it('uses the committed template and pinned edge renderer to return PNG', () => {
    const edge = read('supabase/functions/player-share/index.ts');
    const template = read('public/assets/player-card-template.svg');
    expect(edge).toContain("npm:@vercel/og@0.11.1");
    expect(edge).toContain("npm:react@19.2.7");
    expect(edge).toContain('new ImageResponse');
    expect(edge).toContain('/assets/player-card-template.svg');
    expect(edge).toContain("'Cache-Control': 'public, max-age=300");
    expect(edge).toContain('route.image ? await cardResponse');
    expect(template).toContain('width="1200" height="630"');
    expect(template).toContain('M940 178 1060 265 1014 405 866 405 820 265Z');
  });

  it('emits player-specific Open Graph and Twitter metadata', () => {
    const edge = read('supabase/functions/player-share/index.ts');
    expect(edge).toContain('property="og:image"');
    expect(edge).toContain('name="twitter:card"');
    expect(edge).toContain('image/png');
    expect(edge).toContain('get_game_public_profile');
  });

  it('adds deterministic team data to awards and honours rankings', () => {
    const migration = read('supabase/migrations/20260722210000_player_profile_teams.sql');
    expect(migration).toContain('create or replace function public.get_game_public_profile');
    expect(migration).toContain("'team', team.team");
    expect(migration).toContain("'nick', nick, 'team', team");
    expect(migration).toContain('order by attempt.nick_key, attempt.created_at desc, attempt.id desc');
  });

  it('refreshes awards and profile honours after successful finishes', () => {
    const observer = read('public/attempt-refresh.js');
    const ranking = read('public/ranking-enhancements.js');
    const honours = read('public/honours.js');
    expect(observer).toContain("action !== 'finish'");
    expect(observer).toContain('minuto106:attempt-finished');
    expect(ranking).toContain("document.addEventListener('minuto106:attempt-finished'");
    expect(ranking).toContain("request('stats')");
    expect(honours).toContain("document.addEventListener('minuto106:attempt-finished'");
  });
});