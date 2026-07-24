import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path) => readFileSync(path, 'utf8');
const eligibilityMigration = read('supabase/migrations/20260724114000_profile_revisions_and_eligible_league_trophies.sql');
const readMigration = read('supabase/migrations/20260724114500_keep_league_reads_side_effect_free.sql');
const identityMigration = read('supabase/migrations/20260724115000_use_stable_league_device_identity.sql');
const profileMigration = read('supabase/migrations/20260724115500_unify_player_profile_contract.sql');

describe('security definer permissions', () => {
  it('removes Data API execution from the referral trigger function', () => {
    const migration = read('supabase/migrations/20260724113000_secure_referral_trigger.sql');
    expect(migration).toContain('revoke execute on function public.reward_referred_player() from public;');
    expect(migration).toContain('revoke execute on function public.reward_referred_player() from anon, authenticated;');
  });
});

describe('eligible league activation and trophies', () => {
  it('requires three pairwise-distinct accounts and devices before activation', () => {
    expect(eligibilityMigration).toContain('add column if not exists account_id uuid references public.game_accounts');
    expect(eligibilityMigration).toContain('add column if not exists device_hash text');
    expect(eligibilityMigration).toContain('first_member.account_id <> second_member.account_id');
    expect(eligibilityMigration).toContain('second_member.account_id <> third_member.account_id');
    expect(eligibilityMigration).toContain('first_member.device_hash <> second_member.device_hash');
    expect(eligibilityMigration).toContain('second_member.device_hash <> third_member.device_hash');
    expect(eligibilityMigration).toContain('if v_league.activated_at is null and coalesce((v_state->>\'eligible\')::boolean, false)');
    expect(eligibilityMigration).toContain("set activated_at = v_now,\n        starts_at = v_now,\n        ends_at = v_now + interval '3 days'");
  });

  it('uses a stable first-seen device identity instead of a rotatable current device', () => {
    expect(identityMigration).toContain('player.first_device_hash');
    expect(identityMigration).toContain('v_identity_device_hash');
    expect(identityMigration).toContain('return public.join_game_league(p_code, p_nick_key, v_identity_device_hash)');
    expect(identityMigration).not.toContain('device_hash = excluded.device_hash');
  });

  it('keeps stable read functions side-effect free', () => {
    expect(readMigration).toContain('create or replace function public.get_game_league_status');
    expect(readMigration).toContain('public.get_game_league_status(league.id)');
    expect(readMigration).not.toContain('public.activate_game_league_if_eligible(league.id)');
  });

  it('persists one deterministic champion trophy per eligible completed league', () => {
    expect(eligibilityMigration).toContain('create table if not exists public.game_league_trophies');
    expect(eligibilityMigration).toContain('league_id uuid not null unique');
    expect(eligibilityMigration).toContain('order by attempt.difference_ms, attempt.created_at, attempt.nick_key, attempt.id');
    expect(eligibilityMigration).toContain('on conflict (league_id) do nothing');
    expect(eligibilityMigration).toContain("'type', 'league_champion'");
  });

  it('blocks challenge creation while the league is waiting', () => {
    expect(eligibilityMigration).toContain("return jsonb_build_object('error', 'league_waiting')");
    expect(eligibilityMigration).toContain('create or replace function public.start_game_challenge_pointer_only');
  });
});

describe('versioned profile and league social previews', () => {
  it('changes profile revisions for attempts, daily rewards, achievements and league trophies', () => {
    expect(eligibilityMigration).toContain('create or replace function public.get_game_profile_revision');
    expect(eligibilityMigration).toContain('from public.game_attempts attempt');
    expect(eligibilityMigration).toContain('from public.game_daily_trophies trophy');
    expect(eligibilityMigration).toContain('from public.game_player_achievements achievement');
    expect(eligibilityMigration).toContain('from public.game_league_trophies trophy');
    expect(profileMigration).toContain("'profileRevision', public.get_game_profile_revision(p_nick_key)");
    expect(profileMigration).toContain("'{trophies,leagueChampion}'");
  });

  it('uses one server-rendered social endpoint for profile and league metadata', () => {
    const edge = read('supabase/functions/social-share/index.ts');
    const config = read('supabase/config.toml');
    expect(config).toContain('[functions.social-share]');
    expect(edge).toContain("kind: 'player' as const");
    expect(edge).toContain("kind: 'league' as const");
    expect(edge).toContain('profileImageUrl');
    expect(edge).toContain('leagueImageUrl');
    expect(edge).toContain('property="og:image"');
    expect(edge).toContain('property="og:image:secure_url"');
    expect(edge).toContain('name="twitter:image"');
    expect(edge).toContain('name="twitter:image:src"');
    expect(edge).toContain("url.searchParams.set('v'");
    expect(edge).toContain('new ImageResponse');
  });

  it('mirrors current card metadata into the player page and share actions', () => {
    const playerUi = read('public/player-ui.js');
    const player = read('public/player.js');
    expect(playerUi).toContain("edgeFunctionBaseUrl(apiBaseUrl, 'social-share')");
    expect(playerUi).toContain("edgeUrl.searchParams.set('v'");
    expect(player).toContain("upsertMeta('property', 'og:image', cardUrl)");
    expect(player).toContain("upsertMeta('name', 'twitter:image', cardUrl)");
    expect(player).toContain('player.profileRevision');
    expect(player).toContain('Campeón de liga');
  });

  it('shares league URLs through the metadata endpoint and hides competition while waiting', () => {
    const leagues = read('public/ligas.js');
    expect(leagues).toContain("url.pathname += `/league/${encodeURIComponent(league.code)}`");
    expect(leagues).toContain("url.searchParams.set('v'");
    expect(leagues).toContain('league.waiting === true');
    expect(leagues).toContain("document.querySelector('#competeLeagueLink').hidden = league.active !== true");
    expect(leagues).toContain('3 cuentas y 3 dispositivos únicos');
  });
});
