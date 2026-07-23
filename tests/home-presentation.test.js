import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const homeEnhancement = readFileSync('public/home-ranking-density.js', 'utf8');
const rankingEnhancement = readFileSync('public/ranking-enhancements.js', 'utf8');
const styles = readFileSync('public/v12.css', 'utf8');

describe('home responsive presentation', () => {
  it('moves the existing awards card below the score on mobile and restores the desktop rail', () => {
    expect(homeEnhancement).toContain("const MOBILE_HOME_MEDIA = '(max-width: 700px)'");
    expect(homeEnhancement).toContain('battle.after(awards)');
    expect(homeEnhancement).toContain('rightRail.prepend(awards)');
    expect(homeEnhancement).toContain("media.addEventListener('change', updateAwardsPlacement)");
    expect(styles).toMatch(/@media \(max-width: 700px\)[\s\S]*#awardsCard \{[\s\S]*display: block;/);
  });

  it('keeps daily awards synchronized after every successful attempt', () => {
    expect(rankingEnhancement).toContain("document.addEventListener('minuto106:attempt-finished'");
    expect(rankingEnhancement).toContain('refreshAwards(event.detail?.stats)');
  });

  it('renders each home ranking entry as a stable two-row surface', () => {
    expect(homeEnhancement).toContain("identity.className = 'ranking-player__identity'");
    expect(homeEnhancement).toContain("player.className = 'player ranking-player ranking-player--home'");
    expect(homeEnhancement).toContain('player.replaceChildren(identity, timeElement)');
    expect(styles).toContain('grid-template-rows: auto auto;');
    expect(styles).toContain('grid-row: 1 / span 2;');
    expect(styles).toContain('grid-row: 2;');
  });

  it('uses a single visual row surface without hover displacement', () => {
    expect(styles).toContain('background: transparent !important;');
    expect(styles).toContain('transform: none !important;');
    expect(styles).toContain('border: 1px solid transparent;');
    expect(styles).not.toContain('translateX(');
  });

  it('keeps the country accessible through the flag alternative text without visible country copy', () => {
    expect(homeEnhancement).toContain('image.alt = team.name;');
    expect(homeEnhancement).toContain('identity.append(createFlag(teamKey), nickElement);');
  });
});
