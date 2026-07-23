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

  it('loads the compact layout after every legacy ranking renderer', () => {
    const html = read('public/index.html');
    expect(html.indexOf('./v11.css')).toBeLessThan(html.indexOf('./v12.css'));
    expect(html.indexOf('./ranking-enhancements.js')).toBeLessThan(html.indexOf('./home-ranking-density.js'));
  });

  it('normalizes primary and delayed fallback rows to nickname, accessible flag and inline time', () => {
    const script = read('public/home-ranking-density.js');
    expect(script).toContain("player.querySelector('.player, .ranking-player')");
    expect(script).toContain("image.className = `flag ranking-flag ${team.flagClass}`");
    expect(script).toContain('image.alt = team.name');
    expect(script).toContain('image.width = 20');
    expect(script).toContain('image.height = 14');
    expect(script).toContain("timeElement.className = 'ranking-time'");
    expect(script).toContain('player.replaceChildren(nickElement, createFlag(teamKey), timeElement)');
    expect(script).not.toContain('aria-hidden');
  });

  it('keeps the entire sidebar row on one compact visual line', () => {
    const styles = read('public/v12.css');
    expect(styles).toContain('grid-template-columns:24px minmax(0,1fr) auto');
    expect(styles).toContain('.ranking-player--compact{display:flex!important');
    expect(styles).toContain('align-items:center');
    expect(styles).toContain('.ranking-time{display:inline!important');
    expect(styles).toContain('white-space:nowrap');
    expect(styles).toContain('text-overflow:ellipsis');
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
