import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const layout = readFileSync('public/layout.js', 'utf8');
const actions = readFileSync('public/share-actions.js', 'utf8');
const ranking = readFileSync('public/ranking.js', 'utf8');
const honours = readFileSync('public/honours.js', 'utf8');
const player = readFileSync('public/player.js', 'utf8');
const playerUi = readFileSync('public/player-ui.js', 'utf8');
const edgeShare = readFileSync('supabase/functions/player-share/index.ts', 'utf8');
const rootIndex = readFileSync('index.html', 'utf8');
const publicIndex = readFileSync('public/index.html', 'utf8');

const visibleShareFlows = [layout, actions, ranking, honours, player, playerUi, edgeShare];

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
    expect(actions).toContain('event.stopImmediatePropagation()');
  });

  it('creates direct challenges before opening the share surface', () => {
    expect(actions.indexOf("request('create-duel'"))
      .toBeLessThan(actions.indexOf("title: 'Reto directo · Minuto 106'"));
    expect(actions).toContain("url.searchParams.set('duel', duel.code)");
  });

  it('shares public profiles through clean pages and dynamic metadata endpoints', () => {
    expect(ranking).toContain('playerUi.playerUrl(nick, section)');
    expect(honours).toContain('Minuto106PlayerUI?.shareUrl');
    expect(player).toContain('ui.shareUrl(apiUrl, player.nick, route.section)');
    expect(player).toContain('ui.cardUrl(apiUrl, player.nick, route.section)');
    expect(playerUi).toContain("edgeFunctionBaseUrl(apiBaseUrl, 'player-share')");
    expect(edgeShare).toContain('property="og:image"');
    expect(edgeShare).toContain('property="og:image:secure_url"');
    expect(edgeShare).toContain('name="twitter:image:src"');
    expect(edgeShare).toContain('new ImageResponse');
  });

  it('publishes the root X card through the live site PNG endpoint', () => {
    const siteCard = 'https://imtitjwgiemlaabpioed.supabase.co/functions/v1/player-share/_site/card.png?v=20260723-1';
    for (const html of [rootIndex, publicIndex]) {
      expect(html).toContain('name="twitter:card" content="summary_large_image"');
      expect(html).toContain('name="twitter:image"');
      expect(html).toContain('name="twitter:image:src"');
      expect(html).toContain('property="og:image:secure_url"');
      expect(html).toContain(siteCard);
      expect(html).not.toContain('/public/assets/social-preview');
    }
    expect(edgeShare).toContain("const SITE_ROUTE = '_site'");
    expect(edgeShare).toContain('async function siteCardResponse');
  });

  it('does not intercept private-key clipboard controls', () => {
    expect(actions).not.toContain('#copyPlayerKeyButton');
  });
});
