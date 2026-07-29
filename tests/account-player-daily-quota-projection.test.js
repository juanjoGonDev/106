import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationDirectory = 'supabase/migrations';
const migrationFile = '20260729214000_account_players_daily_quota_projection.sql';
const migration = readFileSync(`${migrationDirectory}/${migrationFile}`, 'utf8');
const normalized = migration.replaceAll(/\s+/g, ' ').toLowerCase();

function version(file) {
  return file.slice(0, 14);
}

describe('linked-player daily quota projection', () => {
  it('ships as the final forward-only account projection correction', () => {
    const migrations = readdirSync(migrationDirectory)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    expect(migrations).toContain(migrationFile);
    expect(version(migrationFile)).toBe(version(migrations.at(-1)));
    expect(normalized).toContain('create or replace function public.get_game_account_players(p_account_token_hash text)');
    expect(normalized).not.toContain('alter function public.get_game_account_players');
    expect(normalized).not.toContain('rename to');
  });

  it('preserves lifetime metrics and overlays the authoritative server-day state', () => {
    expect(normalized).toContain("'attemptsused', coalesce(summary.attempts_used, 0)");
    expect(normalized).toContain("'verifiedattempts', coalesce(summary.verified_attempts, 0)");
    expect(normalized).toContain("'bestdifferencems', summary.best_difference_ms");
    expect(normalized).toContain("'averagedifferencems', summary.average_difference_ms");
    expect(normalized).toContain(') || public.get_game_daily_attempt_state( player.nick_key, clock_timestamp() ) as payload');
    expect(normalized).not.toContain("'attemptsleft', greatest(0, 5");
    expect(normalized).not.toContain("'bonusattempts', coalesce");
  });

  it('resolves canonical accounts and keeps the RPC service-role only', () => {
    expect(normalized).toContain('public.resolve_game_account_token(p_account_token_hash) as id');
    expect(normalized).toContain('security definer set search_path = public, pg_temp');
    expect(normalized).toContain('revoke all on function public.get_game_account_players(text) from public, anon, authenticated');
    expect(normalized).toContain('grant execute on function public.get_game_account_players(text) to service_role');
  });
});
