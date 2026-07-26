import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path) => readFileSync(path, 'utf8');
const progressionMigration = read('supabase/migrations/20260724213000_competitive_progression_public_leagues.sql');
const privateLeagueMigration = read('supabase/migrations/20260724213200_hide_league_competition_credentials.sql');
const compatibilityMigration = read('supabase/migrations/20260724213100_public_league_compatibility.sql');
const player = read('public/player.js');
const playerShare = read('supabase/functions/player-share/index.ts');
const socialShare = read('supabase/functions/social-share/index.ts');
const playerHtml = read('public/player.html');
const leagueHtml = read('public/ligas.html');
const fallbackHtml = read('public/404.html');
const config = read('supabase/config.toml');

describe('versioned profile and league social previews', () => {
  it('versions public profiles from durable player and league changes', () => {
    expect(progressionMigration).toContain("'profileRevision'");
    expect(progressionMigration).toContain("select max(changed_at)");
    expect(progressionMigration).toContain('trophy.awarded_at');
    expect(progressionMigration).toContain('league.created_at');
    expect(progressionMigration).toContain('attempt.created_at');
  });

  it('renders complete versioned profile images through the share endpoint', () => {
    expect(config).toContain('[functions.player-share]');
    expect(playerShare).toContain('player-card-template.svg');
    expect(playerShare).toContain('renderPlayerCard');
    expect(playerShare).toContain("'content-type': 'image/png'");
    expect(playerShare).toContain("'cache-control': 'public, max-age=31536000, immutable'");
    expect(playerShare).toContain('profileRevision');
  });

  it('serves versioned league cards and clean crawler metadata', () => {
    expect(config).toContain('[functions.social-share]');
    expect(socialShare).toContain("route.kind === 'league'");
    expect(socialShare).toContain('get_game_public_league');
    expect(socialShare).toContain('renderLeagueCard');
    expect(socialShare).toContain('league.publicId');
    expect(socialShare).toContain('league.revision');
    expect(socialShare).toContain("'content-type': 'image/png'");
    expect(socialShare).toContain('og:image');
    expect(socialShare).toContain('twitter:image');
    expect(socialShare).toContain('canonical');
  });

  it('keeps every shareable document on a large-image metadata contract', () => {
    for (const document of [playerHtml, leagueHtml, fallbackHtml]) {
      expect(document).toContain('property="og:image"');
      expect(document).toContain('property="og:image:secure_url"');
      expect(document).toContain('name="twitter:card" content="summary_large_image"');
      expect(document).toContain('name="twitter:image"');
      expect(document).toContain('name="twitter:image:src"');
    }
  });

  it('updates live player metadata and links league trophies to clean pages', () => {
    expect(player).toContain("upsertMeta('property', 'og:url', canonicalUrl)");
    expect(player).toContain("upsertMeta('property', 'og:image', cardUrl)");
    expect(player).toContain("upsertMeta('name', 'twitter:image', cardUrl)");
    expect(player).toContain('player.profileRevision');
    expect(player).toContain('Campeón de liga');
    expect(player).toContain('trophy.leaguePublicId');
    expect(player).toContain('ligas/${encodeURIComponent(publicId)}');
  });

  it('separates public league identifiers from private join credentials', () => {
    expect(progressionMigration).toContain('add column if not exists public_id text');
    expect(progressionMigration).toContain('set public_id = code');
    expect(progressionMigration).toContain('set code = public.generate_game_league_token()');
    expect(privateLeagueMigration).toContain('add column if not exists join_code text');
    expect(privateLeagueMigration).toContain('set join_code = code');
    expect(privateLeagueMigration).toContain('set code = public_id');
    expect(privateLeagueMigration).toContain("'publicId', v_public_id");
    expect(privateLeagueMigration).toContain("'joinCode', v_join_code");
    expect(privateLeagueMigration).toContain("'joinCode', case when league.owner_nick_key = p_nick_key then league.join_code else null end");
    expect(privateLeagueMigration).toContain("'competitionCode', league.public_id");
    expect(compatibilityMigration).toContain("jsonb_build_object('code', public_view.payload->>'publicId')");
  });

  it('shares clean public league URLs and keeps private codes out of public rendering', () => {
    const leagues = read('public/ligas.js');
    const fallback = read('public/404.html');
    expect(leagues).toContain('new URL(`ligas/${encodeURIComponent(publicId)}`, leagueBaseUrl)');
    expect(leagues).toContain('league.joinCode');
    expect(leagues).toContain("leagueRequest('league-status', { nick, publicId: resolvedPublicId })");
    expect(leagues).toContain("url.searchParams.set('competition', publicId)");
    expect(leagues).not.toContain('leagueLookupCode');
    expect(fallback).toContain('ligas\\/([A-Z0-9]{6})');
    expect(fallback).toContain("url.searchParams.set('league',league[2].toUpperCase())");
  });
});
