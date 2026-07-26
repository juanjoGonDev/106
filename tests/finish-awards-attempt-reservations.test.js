import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path) => readFileSync(path, 'utf8');
const migrationPath = 'supabase/migrations/20260726120000_finish_awards_attempt_reservations.sql';

describe('finish awards and attempt reservations', () => {
  it('hydrates every game statistics snapshot with daily awards', () => {
    const migration = read(migrationPath);
    const edge = read('supabase/functions/game-api/index.ts');

    expect(migration).toContain('rename to get_game_stats_without_daily_awards');
    expect(migration).toContain("jsonb_build_object('awards', public.get_game_daily_awards())");
    expect(edge).toContain("rpc('get_game_stats')");
    expect(edge).toContain('return jsonResponse(origin, { ...result, stats, profile, league, achievement }, 201);');
  });

  it('counts persisted attempts and active challenges in one competition scope', () => {
    const migration = read(migrationPath);

    expect(migration).toContain('rename to start_game_challenge_pointer_only_without_reservations');
    expect(migration).toContain("v_challenge.nick_key || ':' || coalesce(v_challenge.league_id::text, 'global')");
    expect(migration).toContain('attempt.league_id is not distinct from v_challenge.league_id');
    expect(migration).toContain('challenge.league_id is not distinct from v_challenge.league_id');
    expect(migration).toContain('challenge.consumed_at is null');
    expect(migration).toContain('challenge.expires_at > clock_timestamp()');
    expect(migration).toContain('v_completed_attempts + v_active_challenges > v_max_attempts');
  });

  it('consumes an unexposed over-budget challenge and returns the existing API error', () => {
    const migration = read(migrationPath);

    expect(migration).toContain('update public.game_challenges');
    expect(migration).toContain('set consumed_at = clock_timestamp()');
    expect(migration).not.toMatch(/^\s*delete\s+from\b/im);
    expect(migration).toContain("'error', 'nick_limit'");
    expect(migration).toContain("'attemptsLeft', v_attempts_left");
    expect(migration).toContain("'maxAttempts', v_max_attempts");
  });

  it('keeps wrapped implementations private and exposes only guarded entrypoints', () => {
    const migration = read(migrationPath);

    expect(migration).toContain('get_game_stats_without_daily_awards()\n  from public, anon, authenticated, service_role;');
    expect(migration).toContain('start_game_challenge_pointer_only_without_reservations');
    expect(migration).toContain('from public, anon, authenticated, service_role;');
    expect(migration).toContain('grant execute on function public.get_game_stats() to service_role;');
    expect(migration).toContain('grant execute on function public.start_game_challenge_pointer_only(');
  });

  it('registers the real local Supabase concurrency journey', () => {
    const packageJson = JSON.parse(read('package.json'));
    expect(packageJson.scripts['test:supabase']).toContain('scripts/test-attempt-reservations-local.mjs');
    expect(packageJson.scripts['check:syntax']).toContain('scripts/test-attempt-reservations-local.mjs');
  });
});
