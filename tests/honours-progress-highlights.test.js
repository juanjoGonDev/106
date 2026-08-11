import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const read = (path) => readFileSync(path, 'utf8');
const compatibilityMigrationPath = 'supabase/migrations/20260724213350_adopt_legacy_player_achievement_highlights.sql';
const compatibilityMigration = read(compatibilityMigrationPath);
const migrationPath = 'supabase/migrations/20260724213400_honours_progress_featured_achievements.sql';
const migration = read(migrationPath);
const orderingMigration = read('supabase/migrations/20260724213500_prioritize_featured_achievements.sql');
const playerContext = read('supabase/functions/player-context/index.ts');
const player = read('public/player.js');
const playerHtml = read('public/player.html');
const playerCss = read('public/v15.css');
const profileCardHighlights = read('public/profile-card-highlights.js');
const access = read('public/access.js');
const catalogueSource = read('public/honours-catalog.js');

function loadCatalogue() {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(catalogueSource, context);
  return context.window.Minuto106HonoursCatalog;
}

function profile(overrides = {}) {
  return {
    nick: 'Owner',
    team: 'spain',
    bestDifferenceMs: 80,
    averageDifferenceMs: 120,
    verifiedAttempts: 12,
    completedReferrals: 2,
    trophies: {
      total: 4,
      goldenBoot: 2,
      goldenGlove: 1,
      goldenBall: 1,
      leagueChampion: 0,
      history: [],
    },
    achievements: {
      total: 2,
      points: 120,
      items: [
        {
          code: 'perfect_total_1',
          kind: 'perfect_total',
          title: 'Primer latido perfecto',
          description: 'Clavaste exactamente 10.600.',
          points: 100,
          date: '2026-07-24',
        },
        {
          code: 'verified_total_10',
          kind: 'verified_total',
          title: 'Doble prórroga',
          description: 'Completaste diez intentos verificados.',
          points: 18,
          date: '2026-07-23',
        },
      ],
      featured: [{ code: 'verified_total_10', position: 1 }],
    },
    honoursProgress: {
      perfectAttempts: 1,
      verifiedAttempts: 12,
      completedReferrals: 2,
      duelsCreated: 3,
      duelsWon: 1,
      completedLeagues: 0,
      longestTrophyStreak: 2,
      trophyCategoryCount: 3,
      maxDailyTrophyCategories: 2,
      today: {
        attempts: 2,
        bestDifferenceMs: 80,
        averageDifferenceMs: 120,
        goldenBoot: { targetDifferenceMs: 50, leading: false },
        goldenGlove: { requiredAttempts: 3, targetAverageDifferenceMs: 90, leading: false },
        goldenBall: { targetAttempts: 4, leading: false },
      },
    },
    ...overrides,
  };
}

describe('featured achievement persistence', () => {
  it('stores three ordered unlocked selections without destructive replacement', () => {
    expect(migration).toContain('create table if not exists public.game_player_featured_achievements');
    expect(migration).toContain('position smallint not null check (position between 1 and 3)');
    expect(migration).toContain('where active = true');
    expect(migration).toContain('if cardinality(v_codes) > 3');
    expect(migration).toContain("return jsonb_build_object('error', 'featured_limit')");
    expect(migration).toContain("return jsonb_build_object('error', 'achievement_not_unlocked')");
    expect(migration).toContain('update public.game_player_featured_achievements');
    expect(migration).not.toMatch(/\bdelete\s+from\s+public\.game_player_featured_achievements\b/i);
  });

  it('adopts the observed legacy relation before the canonical honours migration', () => {
    expect(compatibilityMigrationPath.localeCompare(migrationPath)).toBeLessThan(0);
    expect(compatibilityMigration).toContain("to_regclass('public.player_achievement_highlights')");
    expect(compatibilityMigration).toContain('create table if not exists public.game_player_featured_achievements');
    expect(compatibilityMigration).toContain('join public.game_player_achievements achievement');
    expect(compatibilityMigration).toContain('row_number() over');
    expect(compatibilityMigration).toContain('legacy.normalized_position <= 3');
    expect(compatibilityMigration).toContain('current_selection.active = true');
    expect(compatibilityMigration).toContain('revoke all on table public.player_achievement_highlights from public, anon, authenticated');
    expect(compatibilityMigration).not.toMatch(/\bdrop\s+table\b/i);
  });

  it('projects highlights, progress and a revised image cache key', () => {
    expect(migration).toContain("'featured', v_featured");
    expect(migration).toContain("'honoursProgress', v_progress");
    expect(migration).toContain("'profileRevision', v_profile_revision");
    expect(migration).toContain('get_game_player_honours_progress');
    expect(orderingMigration).toContain("coalesce(v_profile #> '{achievements,featured}'");
    expect(orderingMigration).toContain("featured.value->>'code' = item.value->>'code'");
  });

  it('keeps mutation ownership inside the player context function', () => {
    expect(playerContext).toContain("'set-featured-achievements'");
    expect(playerContext).toContain('await accountOwnership(request, key)');
    expect(playerContext).toContain("rpc('set_game_player_featured_achievements'");
    expect(playerContext).toContain('MAX_FEATURED_ACHIEVEMENTS = 3');
    expect(access).toContain("'set-featured-achievements'");
  });
});

describe('honours progress catalogue', () => {
  it('shows featured earned entries first and concrete locked progress', () => {
    const catalogue = loadCatalogue();
    const achievements = catalogue.buildAchievementCatalog(profile());

    expect(achievements[0].code).toBe('verified_total_10');
    expect(achievements[0].featured).toBe(true);
    const nextVerified = achievements.find((achievement) => achievement.code === 'verified_total_25');
    expect(nextVerified.unlocked).toBe(false);
    expect(nextVerified.progress.current).toBe(12);
    expect(nextVerified.progress.target).toBe(25);
    expect(nextVerified.progress.remaining).toBe(13);
    expect(nextVerified.progress.label).toContain('faltan 13');

    const precision = achievements.find((achievement) => achievement.code === 'precision_50');
    expect(precision.progress.label).toContain('mejora 30 ms');
  });

  it('calculates daily trophy objectives and caps distinct highlights at three', () => {
    const catalogue = loadCatalogue();
    const trophies = catalogue.buildTrophyCatalog(profile());
    expect(trophies.find((trophy) => trophy.type === 'golden_boot').progress.label).toContain('Mejora 31 ms');
    expect(trophies.find((trophy) => trophy.type === 'golden_glove').progress.label).toContain('1 intento válido más');
    expect(trophies.find((trophy) => trophy.type === 'golden_ball').progress.label).toContain('2 intentos más');

    expect(catalogue.normalizeFeaturedCodes(
      ['one', 'one', 'two', 'missing', 'three', 'four'],
      new Set(['one', 'two', 'three', 'four']),
    )).toEqual(['one', 'two', 'three']);
  });
});

describe('public profile honours experience', () => {
  it('renders locked collections, progress bars and an owner-only editor', () => {
    expect(playerHtml).toContain('id="playerTrophyCollection"');
    expect(playerHtml).toContain('id="featuredAchievementsEditor"');
    expect(playerHtml).toContain('id="saveFeaturedAchievements"');
    expect(playerHtml).toContain('src="./access.js"');
    expect(playerHtml).toMatch(/src="\.\/honours-catalog\.js\?v=[^"]+"/);
    expect(playerCss).toContain('.honours-card.is-locked');
    expect(playerCss).toContain('filter: grayscale(1)');
    expect(player).toContain('role="progressbar"');
    expect(player).toContain("context.availability === 'owned'");
    expect(player).toContain("requestPlayerContext('set-featured-achievements'");
    expect(player).toContain('data-featured-code');
  });

  it('uses a CORS-safe context request and keeps the public fallback silent', () => {
    expect(playerHtml).toContain('id="retryPlayerProfile"');
    expect(playerHtml).not.toContain('id="playerRecoveryNotice"');
    expect(playerHtml).not.toContain('id="retryPlayerContext"');
    expect(player).toContain("action: 'public-profile'");
    expect(player).toContain("availability: 'unknown'");
    expect(player).toContain('return await requestPublicProfile()');
    expect(player).not.toContain('x-device-id');
    expect(player).not.toContain('minuto106:device-id');
    expect(player).not.toContain('degraded');
    expect(access).toContain("'player-context'");
    expect(access).toContain("headers.set('x-account-token', accountToken)");
    expect(playerContext).toContain("'Access-Control-Allow-Headers': 'content-type, x-account-token, x-device-id'");
  });

  it('uses the highlighted achievement card for profile sharing and generated previews', () => {
    expect(playerHtml).toContain('src="./profile-card-highlights.js"');
    expect(profileCardHighlights).toContain("section === 'overview' ? 'achievements' : section");
    expect(profileCardHighlights).toContain('playerUi.cardUrl(apiBaseUrl, nick, cardSection, revision)');
    expect(orderingMigration).toContain("coalesce((featured.value->>'position')::integer, 2147483647)");
  });
});