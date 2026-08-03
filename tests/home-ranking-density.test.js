import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path) => readFileSync(path, 'utf8');

describe('home score and ranking density', () => {
  it('removes the visible aggregate metrics section while keeping safe renderer targets', () => {
    const html = read('public/index.html');
    expect(html).not.toContain('class="stats-strip"');
    expect(html).not.toContain('aria-label="Estadísticas globales"');
    expect(html).not.toContain('jugadores globales</span>');
    expect(html).not.toContain('intentos globales validados</span>');
    expect(html).not.toContain('tiempos globales perfectos</span>');
    expect(html).toContain('class="stats-render-targets" hidden aria-hidden="true"');
  });

  it('loads the authoritative renderer before awards and responsive placement', () => {
    const html = read('public/index.html');
    const awards = './ranking-enhancements.js?v=20260802-awards-reset';
    expect(html.indexOf('./v12.css')).toBeLessThan(html.indexOf('./v13.css'));
    expect(html.indexOf('./home-stats.js?v=20260724')).toBeLessThan(html.indexOf(awards));
    expect(html.indexOf(awards)).toBeLessThan(html.indexOf('./home-ranking-density.js?v=20260723'));
  });

  it('builds complete accessible rows directly in the authoritative renderer', () => {
    const script = read('public/home-stats.js');
    const density = read('public/home-ranking-density.js');
    const styles = read('public/v12.css');
    expect(script).toContain("identity.className = 'ranking-player__identity'");
    expect(script).toContain("const flag = document.createElement('span')");
    expect(script).toContain('flag.className = `flag ranking-flag ${team.flagClass}`');
    expect(script).toContain("flag.setAttribute('role', 'img')");
    expect(script).toContain("flag.setAttribute('aria-label', team.name)");
    expect(script).toContain("time.className = 'ranking-time'");
    expect(script).toContain('identity.append(createFlag(team), nickElement)');
    expect(script).toContain('player.append(identity, time)');
    expect(script).toContain('list.replaceChildren(...rows)');
    expect(density).not.toContain('MutationObserver');
    expect(density).not.toContain('ensureAnchor');
    expect(styles).not.toContain('background: none;');
  });

  it('owns loading, empty, ready and error states in one module', () => {
    const html = read('public/index.html');
    const script = read('public/home-stats.js');
    expect(html).toContain('aria-busy="true" data-render-state="loading"');
    expect(script).toContain("list.dataset.renderState = 'empty'");
    expect(script).toContain("list.dataset.renderState = 'ready'");
    expect(script).toContain("list.dataset.renderState = 'error'");
    expect(script).toContain("list.removeAttribute('aria-busy')");
    expect(script).not.toContain("list.dataset.renderState = 'waiting'");
  });

  it('renders daily awards synchronously from the shared snapshot', () => {
    const script = read('public/ranking-enhancements.js');
    expect(script).toContain('const homeStats = window.Minuto106HomeStats');
    expect(script).toContain('homeStats.subscribe(renderAwards)');
    expect(script).toContain("const selectors = ['#goldenBoot', '#goldenGlove', '#goldenBall']");
    expect(script).toContain('target.innerHTML = awardHtml(views[index])');
    expect(script).toContain('role="img"');
    expect(script).toContain('aria-label=');
    expect(script).not.toContain('Promise.all');
    expect(script).not.toContain('public-profile');
    expect(script).not.toContain("request('stats')");
  });

  it('renders one stable two-row surface in the desktop rail', () => {
    const styles = read('public/v12.css');
    expect(styles).toContain('grid-template-columns: 24px minmax(0, 1fr) auto;');
    expect(styles).toContain('grid-template-rows: auto auto;');
    expect(styles).toContain('.ranking-player--home {');
    expect(styles).toContain('grid-row: 1 / span 2;');
    expect(styles).toContain('grid-row: 2;');
    expect(styles).toContain('background: transparent !important;');
    expect(styles).toContain('transform: none !important;');
    expect(styles).not.toContain('translateX(');
    expect(styles).toContain('white-space: nowrap;');
    expect(styles).toContain('text-overflow: ellipsis;');
  });

  it('matches the daily-awards spacing without inherited list-item padding', () => {
    const styles = read('public/v12.css');
    expect(styles).toMatch(/\.layout-rail \.leaderboard \{\s+gap: 8px;/);
    expect(styles).toMatch(/\.layout-rail \.leaderboard \.leaderboard-row \{[\s\S]*?margin: 0 !important;[\s\S]*?padding: 0 !important;/);
  });

  it('moves the existing awards card below the score on mobile and restores the desktop rail', () => {
    const script = read('public/home-ranking-density.js');
    const styles = read('public/v12.css');
    expect(script).toContain("const MOBILE_HOME_MEDIA = '(max-width: 700px)'");
    expect(script).toContain('battle.after(awards)');
    expect(script).toContain('rightRail.prepend(awards)');
    expect(script).toContain("media.addEventListener('change', updateAwardsPlacement)");
    expect(styles).toMatch(/@media \(max-width: 700px\)[\s\S]*#awardsCard \{[\s\S]*display: block;/);
  });
});