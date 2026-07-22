import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const layout = readFileSync('public/layout.js', 'utf8');
const actions = readFileSync('public/share-actions.js', 'utf8');
const ranking = readFileSync('public/ranking.js', 'utf8');
const honours = readFileSync('public/honours.js', 'utf8');
const overlay = readFileSync('public/profile-overlay.js', 'utf8');

const visibleShareFlows = [layout, actions, ranking, honours, overlay];

describe('share-first social actions', () => {
  it('provides native sharing plus explicit desktop destinations', () => {
    expect(layout).toContain("typeof navigator.share === 'function'");
    expect(layout).toContain('data-share-destination="whatsapp"');
    expect(layout).toContain('data-share-destination="x"');
    expect(layout).toContain('data-share-destination="telegram"');
    expect(layout).toContain('mailto:?subject=');
  });

  it.each(visibleShareFlows)('opens the shared surface without clipboard fallbacks', (source) => {
    expect(source).not.toContain('navigator.clipboard');
    expect(source).not.toContain('writeText(');
  });

  it('intercepts every visible challenge, result, referral and league share control', () => {
    for (const selector of [
      '#shareButton',
      '#copyReferralButton',
      '#createDuelButton',
      '#quickDuelButton',
      '#shareLeagueButton',
      '[data-share-league]',
    ]) expect(actions).toContain(selector);
    expect(actions).toContain("event.stopImmediatePropagation()");
  });

  it('creates direct challenges before opening the share surface', () => {
    expect(actions.indexOf("request('create-duel'"))
      .toBeLessThan(actions.indexOf("title: 'Reto directo · Minuto 106'"));
    expect(actions).toContain("url.searchParams.set('duel', duel.code)");
  });

  it('shares public profiles through stable nickname URLs', () => {
    expect(ranking).toContain("url.searchParams.set('nick', profile.nick)");
    expect(honours).toContain("url.searchParams.set('nick', profile.nick)");
    expect(overlay).toContain("url.searchParams.set('nick', profile.nick)");
  });

  it('does not intercept private-key clipboard controls', () => {
    expect(actions).not.toContain('#copyPlayerKeyButton');
  });
});
