import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readdirSync('supabase/migrations')
  .filter((file) => file.startsWith('20260722160') && file.endsWith('.sql'))
  .sort()
  .map((file) => readFileSync(join('supabase/migrations', file), 'utf8'))
  .join('\n');

function functionBody(name) {
  const pattern = new RegExp(`create or replace function public\\.${name}\\([^]*?\\n\\$\\$;`, 'i');
  return migration.match(pattern)?.[0] || '';
}

describe('persistent daily trophies and achievements', () => {
  it('stores immutable daily awards and idempotent processing runs', () => {
    expect(migration).toContain('create table if not exists public.game_trophy_award_runs');
    expect(migration).toContain('create table if not exists public.game_daily_trophies');
    expect(migration).toContain('unique (award_date, trophy_type)');
    expect(migration).toContain('on conflict (award_date, trophy_type) do nothing');
    expect(migration).toContain("pg_advisory_xact_lock(hashtextextended('minuto106:trophy-sync', 106))");
  });

  it('uses Madrid calendar days and never closes the current day', () => {
    const award = functionBody('award_game_trophies_for_date');
    const sync = functionBody('sync_game_trophy_history');
    expect(award).toContain("clock_timestamp() at time zone 'Europe/Madrid'");
    expect(award).toContain('p_award_date >= v_today');
    expect(sync).toContain('v_today - 1');
    expect(migration).toContain("'provisional', true");
  });

  it('excludes league and unverified attempts from every trophy category', () => {
    const award = functionBody('award_game_trophies_for_date');
    const current = functionBody('get_game_daily_awards');
    for (const body of [award, current]) {
      expect(body).toContain('verified = true');
      expect(body).toContain('league_id is null');
    }
  });

  it('preserves the established deterministic award definitions', () => {
    const award = functionBody('award_game_trophies_for_date');
    expect(award).toContain("'golden_boot'::text");
    expect(award).toContain('order by best_difference_ms, best_at, nick_key');
    expect(award).toContain("'golden_glove'::text");
    expect(award).toContain('where attempts >= 3');
    expect(award).toContain('order by average_difference_ms, best_difference_ms, best_at, nick_key');
    expect(award).toContain("'golden_ball'::text");
    expect(award).toContain('order by attempts desc, best_difference_ms, average_difference_ms, best_at, nick_key');
  });

  it('derives milestone, category, streak, monthly and collection achievements', () => {
    for (const contract of [
      'first_trophy',
      'trophy_total_',
      'category_total_',
      'trophy_streak_',
      'first_of_month_',
      'complete_set',
      'daily_hat_trick_',
    ]) expect(migration).toContain(contract);
    expect(migration).toContain('(10, 30)');
    expect(migration).toContain('(7, 60)');
    expect(migration).toContain('row_number() over(order by award_date, awarded_at, trophy_type)');
    expect(migration).toContain('award_date - row_number() over(order by award_date)::integer as island_key');
  });

  it('exposes dated trophy history, achievements and both honours rankings', () => {
    const profile = functionBody('get_game_player_profile');
    const rankings = functionBody('get_game_honours_rankings');
    expect(profile).toContain("'trophies', jsonb_build_object(");
    expect(profile).toContain("'date', trophy.award_date");
    expect(profile).toContain("'achievements', jsonb_build_object(");
    expect(rankings).toContain("'trophies', coalesce");
    expect(rankings).toContain("'achievements', coalesce");
    expect(functionBody('get_game_stats')).toContain("'honoursRankings', public.get_game_honours_rankings()");
  });

  it('backfills historical closed days as part of the additive migration', () => {
    expect(migration.trimEnd()).toMatch(/select public\.sync_game_trophy_history\(\);$/);
    expect(migration).not.toMatch(/\bdrop\s+(table|column|function|type|schema)\b/i);
    expect(migration).not.toMatch(/\btruncate\b/i);
    expect(migration).not.toMatch(/\bdelete\s+from\b/i);
  });
});
