import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path) => readFileSync(path, 'utf8');
const migration = read('supabase/migrations/20260724213000_competitive_progression_public_leagues.sql');
const compatibility = read('supabase/migrations/20260724213100_public_league_compatibility.sql');
const privateLeagueMigration = read('supabase/migrations/20260724213200_hide_league_competition_credentials.sql');
const leagueInvariantMigration = read('supabase/migrations/20260724213300_enforce_league_identifiers.sql');
const playerContext = read('supabase/functions/player-context/index.ts');
const config = read('supabase/config.toml');
const app = read('public/app.js');
const competition = read('public/competition.js');
const honours = read('public/honours.js');
const index = read('public/index.html');
const ranking = read('public/ranking.js');
const rankingHtml = read('public/ranking.html');
const leagues = read('public/ligas.js');
const leaguesHtml = read('public/ligas.html');
const fallback = read('public/404.html');

describe('engagement achievements', () => {
  it('adds cumulative perfect, challenge, sharing and league achievement families', () => {
    for (const kind of [
      'perfect_total',
      'perfect_average',
      'verified_total',
      'precision',
      'referral_total',
      'duel_created',
      'duel_wins',
      'league_participation',
      'league_podium',
    ]) expect(migration).toContain(`'${kind}'`);

    for (const title of [
      'Primer latido perfecto',
      'Reloj dominado',
      'Media imposible',
      'Rodaje competitivo',
      'Guante lanzado',
      'Primer duelo ganado',
      'Dominador de duelos',
      'Convocatoria completa',
      'Jugador de liga',
      'Podio de liga',
    ]) expect(migration).toContain(title);
  });

  it('uses durable, idempotent threshold and per-league achievement codes', () => {
    expect(migration).toContain('(1, 15), (3, 25), (5, 40), (10, 75), (25, 140), (50, 240), (100, 400)');
    expect(migration).toContain('(1, 20), (5, 55), (10, 100), (50, 260), (100, 450)');
    expect(migration).toContain("'league_podium_' || podium.public_id");
    expect(migration).toContain('on conflict (nick_key, achievement_code) do nothing');
    expect(migration).toContain('case podium.position when 1 then 60 when 2 then 35 else 20 end');
  });

  it('refreshes progression after attempts, duels and completed leagues', () => {
    expect(migration).toContain('game_attempts_refresh_progression');
    expect(migration).toContain('game_duels_refresh_progression');
    expect(migration).toContain('perform public.refresh_game_player_progression_achievements(v_member.nick_key)');
    expect(migration).toContain('perform public.refresh_game_player_progression_achievements(p_nick_key)');
  });
});

describe('deterministic global ranking', () => {
  it('orders equal times by progression, activity and stable final keys', () => {
    const expectedOrder = [
      'best.difference_ms',
      'coalesce(achievement.achievement_points, 0) desc',
      'coalesce(daily.daily_trophies, 0) desc',
      'coalesce(league.league_wins, 0) desc',
      'summary.verified_attempts desc',
      'summary.average_difference_ms',
      'best.best_at',
      'best.nick_key',
    ];
    let previous = -1;
    for (const expression of expectedOrder) {
      const position = migration.indexOf(expression, previous + 1);
      expect(position, expression).toBeGreaterThan(previous);
      previous = position;
    }
    expect(migration).toContain("'rankingVersion', 2");
    expect(migration).toContain("'tiedOnTime', same_time_players > 1");
  });

  it('keeps the home compact and explains exact tie-break evidence on the dedicated ranking', () => {
    expect(index).not.toContain('id="totalAttempts"');
    expect(index).not.toContain('Pulsa sobre un jugador para abrir su página pública');
    expect(index).toContain('Ver clasificación y desempates');
    expect(ranking).toContain('entry.tiedOnTime !== true');
    expect(ranking).toContain('entry.achievementPoints');
    expect(ranking).toContain('entry.dailyTrophies');
    expect(ranking).toContain('entry.leagueWins');
    expect(ranking).toContain('entry.verifiedAttempts');
    expect(rankingHtml).toContain('Cómo se ordena la precisión');
    expect(rankingHtml).toContain('puntos de logros');
    expect(rankingHtml).toContain('ligas ganadas, con menor peso');
  });
});

describe('single player context and attempt gating', () => {
  it('registers a dedicated context function that checks ownership without creating an account', () => {
    expect(config).toContain('[functions.player-context]');
    expect(playerContext).toContain("const ACTIONS = new Set(['account-context', 'player-context', 'set-featured-achievements'])");
    expect(playerContext).toContain("rpc('get_game_player_profile'");
    expect(playerContext).toContain("rpc('get_game_account_players'");
    expect(playerContext).toContain("rpc('get_game_player_leagues'");
    expect(playerContext).toContain("rpc('get_game_account_daily_attempt_policy_by_token'");
    expect(playerContext).not.toContain('ensure_game_account_player');
    expect(playerContext).not.toContain('create_game_account');
  });

  it('removes independent home profile requests and renders honours from the shared context', () => {
    expect(app).not.toContain("request('profile'");
    expect(honours).not.toContain("request('profile'");
    expect(honours).not.toContain('MutationObserver');
    expect(honours).toContain("document.addEventListener('minuto106:player-context'");
    expect(competition).toContain("return requestContext('player-context', nick)");
    expect(competition).toContain("return requestContext('account-context')");
    expect(competition).toContain('if (sequence !== requestSequence || nick !== currentNick())');
    expect(competition).toContain('window.clearTimeout(debounceTimer)');
    expect(competition).toContain('}, 350)');
  });

  it('uses a cached global-or-league selector and blocks unavailable scopes before start', () => {
    expect(index).toContain('id="competitionPicker"');
    expect(index).toContain('Dónde cuenta este intento');
    expect(competition).toContain("const selectionKey = 'minuto106:competition-v1'");
    expect(competition).toContain("let selectedValue = 'global'");
    expect(competition).toContain('localStorage.setItem(selectionKey, value)');
    expect(competition).toContain('option.disabled = league.active !== true');
    expect(competition).toContain("context.availability !== 'occupied'");
    expect(competition).toContain('scope.available');
    expect(app).toContain('window.Minuto106Competition?.canStart === true');
    expect(app).toContain("await uiError('Selecciona una competición con intentos disponibles");
    expect(app).toContain("$('#retryButton').hidden = data.attemptsLeft === 0");
  });
});

describe('public league identity and routes', () => {
  it('rotates previously exposed credentials into a private join column', () => {
    expect(migration).toContain('set public_id = code');
    expect(migration).toContain('set code = public.generate_game_league_token()');
    expect(privateLeagueMigration).toContain('add column if not exists join_code text');
    expect(privateLeagueMigration).toContain('set join_code = code');
    expect(privateLeagueMigration).toContain('set code = public_id');
    expect(privateLeagueMigration).toContain('check (join_code <> public_id)');
    expect(privateLeagueMigration).toContain('where join_code = upper(trim(p_code))');
    expect(privateLeagueMigration).toContain("'competitionCode', league.public_id");
    expect(privateLeagueMigration).toContain("'joinCode', case when league.owner_nick_key = p_nick_key then league.join_code else null end");
    expect(leagueInvariantMigration).toContain('before insert or update of code, public_id, join_code');
    expect(leagueInvariantMigration).toContain('new.public_id := new.code');
    expect(leagueInvariantMigration).toContain('new.join_code := public.generate_game_league_token()');
  });

  it('keeps the anonymous public projection secret-free', () => {
    expect(migration).toContain('create or replace function public.get_game_public_league(p_public_id text)');
    const publicLeague = migration.slice(
      migration.indexOf('create or replace function public.get_game_public_league(p_public_id text)'),
      migration.indexOf('create or replace function public.get_game_public_league_by_competition_code'),
    );
    expect(publicLeague).not.toContain("'joinCode'");
    expect(publicLeague).not.toContain("'competitionCode'");
    expect(compatibility).toContain("jsonb_build_object('code', public_view.payload->>'publicId')");
  });

  it('uses stable clean public URLs while reserving the join key for invitations', () => {
    expect(leagues).toContain('const leagueBaseUrl = cleanRouteMatch');
    expect(leagues).toContain('new URL(`ligas/${encodeURIComponent(publicId)}`, leagueBaseUrl)');
    expect(leagues).toContain("document.querySelector('#leagueJoinCode')");
    expect(leagues).toContain('Código privado: ${league.joinCode}');
    expect(leagues).toContain("history.replaceState(null, '', leaguePublicUrl(resolvedPublicId))");
    expect(leaguesHtml).toContain('id="leagueJoinCode"');
    expect(leaguesHtml).not.toContain('id="leagueLookupCode"');
    expect(fallback).toContain('ligas\\/([A-Z0-9]{6})');
    expect(fallback).toContain('ligas.html');
  });

  it('provides Open Graph and X/Twitter image metadata on every dedicated document', () => {
    for (const document of [rankingHtml, leaguesHtml, fallback]) {
      expect(document).toContain('property="og:image"');
      expect(document).toContain('property="og:image:secure_url"');
      expect(document).toContain('name="twitter:card" content="summary_large_image"');
      expect(document).toContain('name="twitter:image"');
      expect(document).toContain('name="twitter:image:src"');
    }
    expect(leagues).toContain("upsertMeta('property', 'og:image', imageUrl)");
    expect(leagues).toContain("upsertMeta('name', 'twitter:image', imageUrl)");
  });
});
