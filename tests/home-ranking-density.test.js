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

  it('loads the home presentation after every legacy ranking renderer', () => {
    const html = read('public/index.html');
    expect(html.indexOf('./v11.css')).toBeLessThan(html.indexOf('./v12.css'));
    expect(html.indexOf('./ranking-enhancements.js')).toBeLessThan(html.indexOf('./home-ranking-density.js'));
  });

  it('normalizes rows to accessible identity and timing lines', () => {
    const script = read('public/home-ranking-density.js');
    expect(script).toContain("anchor.querySelector('.player, .ranking-player')");
    expect(script).toContain("identity.className = 'ranking-player__identity'");
    expect(script).toContain("image.className = `flag ranking-flag ${team.flagClass}`");
    expect(script).toContain('image.alt = team.name');
    expect(script).toContain('image.width = 20');
    expect(script).toContain('image.height = 14');
    expect(script).toContain("timeElement.className = 'ranking-time'");
    expect(script).toContain('identity.append(createFlag(teamKey), nickElement)');
    expect(script).toContain('player.replaceChildren(identity, timeElement)');
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
    const rankingEnhancement = read('public/ranking-enhancements.js');

    expect(script).toContain("const MOBILE_HOME_MEDIA = '(max-width: 700px)'");
    expect(script).toContain('battle.after(awards)');
    expect(script).toContain('rightRail.prepend(awards)');
    expect(script).toContain("media.addEventListener('change', updateAwardsPlacement)");
    expect(styles).toMatch(/@media \(max-width: 700px\)[\s\S]*#awardsCard \{[\s\S]*display: block;/);
    expect(rankingEnhancement).toContain("document.addEventListener('minuto106:attempt-finished'");
    expect(rankingEnhancement).toContain('refreshAwards(event.detail?.stats)');
  });

  it('ships local flag images with intrinsic dimensions and accessible names', () => {
    const spain = read('public/assets/flag-spain.svg');
    const argentina = read('public/assets/flag-argentina.svg');
    for (const flag of [spain, argentina]) {
      expect(flag).toContain('width="30" height="20"');
      expect(flag).toContain('role="img"');
      expect(flag).toContain('<title id="title">Bandera de ');
    }
  });
});
