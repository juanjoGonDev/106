import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const layout = readFileSync('public/layout.js', 'utf8');
const actions = readFileSync('public/share-actions.js', 'utf8');
const duelContext = readFileSync('public/duel-context.js', 'utf8');
const ranking = readFileSync('public/ranking.js', 'utf8');
const honours = readFileSync('public/honours.js', 'utf8');
const leagues = readFileSync('public/ligas.js', 'utf8');
const player = readFileSync('public/player.js', 'utf8');
const playerUi = readFileSync('public/player-ui.js', 'utf8');
const edgeShare = readFileSync('supabase/functions/player-share/index.ts', 'utf8');
const socialShare = readFileSync('supabase/functions/social-share/index.ts', 'utf8');
const rootIndex = readFileSync('index.html', 'utf8');
const publicIndex = readFileSync('public/index.html', 'utf8');

const visibleShareFlows = [layout, actions, duelContext, ranking, honours, leagues, player, playerUi, edgeShare, socialShare];

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

  it('intercepts home challenge, result and referral controls while league management owns its private invitations', () => {
    for (const selector of [
      '#shareButton',
      '#copyReferralButton',
      '#createDuelButton',
      '#quickDuelButton',
    ]) expect(actions).toContain(selector);
    expect(actions).not.toContain('#shareLeagueButton');
    expect(actions).not.toContain('[data-share-league]');
    expect(actions).not.toContain('#createLeagueForm');
    expect(actions).toContain('event.stopImmediatePropagation()');
    expect(leagues).toContain("document.querySelector('#shareLeagueButton')");
    expect(leagues).toContain("document.querySelector('#createLeagueForm')");
  });

  it('creates direct challenges and shares the exact persisted target through the public game URL', () => {
    expect(actions.indexOf("request('create-duel'"))
      .toBeLessThan(actions.indexOf("title: `${nick} te reta · Minuto 106`"));
    expect(actions).toContain('url: duelCanonicalUrl(duel.code)');
    expect(actions).toContain("url.searchParams.set('duel', code)");
    expect(actions).toContain('duel.targetElapsedMs');
    expect(actions).toContain('duel.targetDifferenceMs');
    expect(duelContext).toContain("requestShareData('duel', duelCode)");
    expect(duelContext).toContain('formatElapsed(duel.targetElapsedMs)');
  });

  it('shares persisted attempts, referrals, profiles and leagues through canonical website routes', () => {
    expect(ranking).toContain('playerUi.playerUrl(nick, section)');
    expect(honours).toContain('url: profileUrl(profile)');
    expect(player).toContain('const share = ui.playerUrl(player.nick, route.section)');
    expect(player).toContain("upsertMeta('property', 'og:url', canonicalUrl)");
    expect(player).toContain('ui.cardUrl(apiUrl, player.nick, route.section, player.profileRevision)');
    expect(playerUi).not.toContain("edgeFunctionBaseUrl(apiBaseUrl, 'social-share')");
    expect(playerUi).toContain("edgeFunctionBaseUrl(apiBaseUrl, 'player-share')");
    expect(actions).toContain("url.searchParams.set('sharedResult', attempt.id)");
    expect(actions).toContain("url.searchParams.set('ref', profile.referralCode)");
    expect(actions).toContain('new URL(`./ligas/${encodeURIComponent(publicId)}`');
    expect(leagues).toContain('new URL(`./ligas/${encodeURIComponent(publicId)}`');
    expect(actions).not.toContain("'/social-share'");
    expect(actions).not.toContain('league.code');
    expect(leagues).toContain('Código privado: ${league.joinCode}');
    expect(actions).toContain("document.addEventListener('minuto106:attempt-finished'");
  });

  it('reuses the loaded player context before requesting a profile for a manual share', () => {
    expect(actions).toContain('window.Minuto106Competition?.context');
    expect(actions).toContain("context?.availability === 'owned'");
    expect(actions.indexOf('const cached = cachedOwnedProfile()'))
      .toBeLessThan(actions.indexOf("return request('profile', { nick })"));
  });

  it('keeps dynamic metadata and PNG renderers as internal infrastructure', () => {
    expect(socialShare).toContain('property="og:image"');
    expect(socialShare).toContain('property="og:image:secure_url"');
    expect(socialShare).toContain('name="twitter:image:src"');
    expect(socialShare).toContain("url.searchParams.set('v'");
    expect(edgeShare).toContain('new ImageResponse');
  });

  it('publishes the root X card through the repository-owned social preview', () => {
    const siteCard = 'https://juanjogondev.github.io/106/assets/minuto-106-social-preview.jpg?v=20260723-3';
    for (const html of [rootIndex, publicIndex]) {
      expect(html).toContain('name="twitter:card" content="summary_large_image"');
      expect(html).toContain('name="twitter:image"');
      expect(html).toContain('name="twitter:image:src"');
      expect(html).toContain('property="og:image:secure_url"');
      expect(html).toContain('property="og:image:type" content="image/jpeg"');
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
