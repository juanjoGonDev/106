import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const integrityMigration = readFileSync(
  'supabase/migrations/20260809230000_ranked_integrity_engine.sql',
  'utf8',
);
const integrityPrivilegesMigration = readFileSync(
  'supabase/migrations/20260809230050_ranked_integrity_privileges.sql',
  'utf8',
);
const rewardMigration = readFileSync(
  'supabase/migrations/20260809230100_ranked_reward_reconciliation.sql',
  'utf8',
);
const snapshotComparator = readFileSync('scripts/compare-production-snapshots.mjs', 'utf8');

function functionBody(source, name) {
  const pattern = new RegExp(`create or replace function public\\.${name}\\([^]*?\\n\\$\\$;`, 'i');
  return source.match(pattern)?.[0] ?? '';
}

describe('ranked integrity reconciliation', () => {
  it('keeps raw attempts and a private versioned reversible integrity projection', () => {
    expect(integrityMigration).toContain('create table if not exists public.game_attempt_integrity');
    expect(integrityMigration).toContain('create table if not exists public.game_attempt_integrity_events');
    expect(integrityMigration).toContain("status in ('eligible', 'watch', 'excluded')");
    expect(integrityMigration).toContain('policy_version integer not null default 2');
    expect(integrityMigration).toContain('alter table public.game_attempt_integrity enable row level security');
    expect(integrityMigration).toContain('revoke all on table public.game_attempt_integrity, public.game_attempt_integrity_events');
    expect(integrityPrivilegesMigration).toContain(
      'grant select, insert on table public.game_attempt_integrity_events',
    );
    expect(integrityPrivilegesMigration).not.toMatch(
      /grant\s+(?:all|update|delete)[^;]*game_attempt_integrity_events/i,
    );
    expect(rewardMigration).not.toMatch(/delete\s+from\s+public\.game_attempts/i);
  });

  it('treats legacy heuristic failures as reassessable while preserving hard failures', () => {
    const hardValidity = functionBody(integrityMigration, 'game_attempt_hard_valid');
    expect(hardValidity).toContain("'repeated_near_perfect_results'");
    expect(hardValidity).toContain("'repeated_interaction_fingerprint'");
    expect(hardValidity).toContain('<@ array[');
    expect(hardValidity).not.toContain("'timing_mismatch'");
    expect(hardValidity).not.toContain("'device_mismatch'");
  });

  it('never excludes on precision or IP alone', () => {
    const decision = functionBody(integrityMigration, 'game_attempt_integrity_decision');
    expect(decision).toContain("v_status := 'watch'");
    expect(decision).toContain('v_score >= 65');
    expect(decision).toContain('v_near >= 4');
    expect(decision).toContain('v_fingerprint >= 3');
    expect(decision).toContain('(v_nicks >= 3 or v_automation_shape >= 4)');
    expect(decision).toContain("'shared_ip_context'");
    expect(decision).not.toMatch(/v_ip_(?:near|devices)[^\n]*then\s*\n?\s*v_status\s*:=\s*'excluded'/i);
  });

  it('can invalidate earlier attempts only through a bounded same-device retrospective cluster', () => {
    const reassess = functionBody(rewardMigration, 'reassess_game_integrity_cluster');
    expect(reassess).toContain("attempt.created_at between v_anchor.created_at - interval '24 hours' and v_anchor.created_at");
    expect(reassess).toContain('attempt.device_hash = v_anchor.device_hash');
    expect(reassess).toContain("v_next_status := case");
    expect(reassess).toContain("v_target.status = 'excluded' or v_decision_status = 'excluded'");
    expect(reassess).toContain('update public.game_attempts');
    expect(reassess).toContain('perform public.reconcile_game_integrity_attempts(v_changed_attempts)');
  });

  it('uses one backend owner for every date-based daily award decision', () => {
    const candidates = functionBody(rewardMigration, 'game_daily_award_candidates');
    const current = functionBody(rewardMigration, 'get_game_daily_awards');
    const dated = functionBody(rewardMigration, 'get_game_daily_awards_for_date');
    const reconcile = functionBody(rewardMigration, 'reconcile_game_trophies_for_date');
    const progress = functionBody(rewardMigration, 'get_game_player_honours_progress');

    expect(candidates).toContain("'golden_boot'::text");
    expect(candidates).toContain("'golden_glove'::text");
    expect(candidates).toContain("'golden_ball'::text");
    expect(candidates).toContain('order by summary.best_difference_ms, summary.best_at, summary.nick_key');
    expect(candidates).toContain('where summary.attempts >= 3');
    expect(candidates).toContain('order by summary.attempts desc, summary.best_difference_ms, summary.average_difference_ms, summary.best_at, summary.nick_key');

    expect(current).toContain('public.get_game_daily_awards_for_date');
    expect(dated).toContain('public.game_daily_award_candidates(p_award_date)');
    expect(reconcile).toContain('public.game_daily_award_candidates(p_award_date)');
    expect(progress).toContain('public.game_daily_award_candidates(day_window.today)');
    expect(progress).not.toContain('boot_leader as');
    expect(progress).not.toContain('glove_leader as');
    expect(progress).not.toContain('ball_leader as');
  });

  it('reassigns derived trophies and rebuilds dependent achievements', () => {
    const daily = functionBody(rewardMigration, 'reconcile_game_trophies_for_date');
    const league = functionBody(rewardMigration, 'reconcile_game_league_trophy');
    const achievements = functionBody(integrityMigration, 'rebuild_game_player_achievements');
    const referral = functionBody(integrityMigration, 'reconcile_game_account_referral');

    expect(daily).toContain('on conflict (award_date, trophy_type) do update');
    expect(daily).toContain('delete from public.game_daily_trophies');
    expect(daily).toContain('perform public.rebuild_game_player_achievements');
    expect(league).toContain('on conflict (league_id) do update');
    expect(league).toContain('delete from public.game_league_trophies');
    expect(league).toContain('perform public.rebuild_game_player_achievements');

    expect(achievements).toContain('delete from public.game_player_achievements');
    expect(achievements).toContain('public.refresh_game_player_achievements');
    expect(achievements).toContain('public.refresh_game_player_progression_achievements');
    expect(achievements).toContain('game_player_featured_achievements');
    expect(referral).toContain('offset 4');
    expect(referral).toContain('set completed_at = v_fifth_verified_at');
  });

  it('runs the integrity engine after the server-authoritative pointer finish', () => {
    const finish = functionBody(rewardMigration, 'finish_game_attempt_pointer_only');
    expect(finish).toContain("'clientTelemetry', coalesce(p_client_signals, '{}'::jsonb)");
    expect(finish).toContain('perform public.reassess_game_integrity_cluster(v_attempt_id)');
    expect(finish).toContain("jsonb_set(v_result, '{attempt,verified}'");
    expect(finish).toContain('v_transport_delta_ms not between -750 and 2500');
  });

  it('keeps raw production history monotonic but allows derived fraud corrections', () => {
    for (const metric of ['attempts', 'players', 'referrals', 'duels', 'leagues', 'accounts']) {
      expect(snapshotComparator).toMatch(new RegExp(`'${metric}'`));
    }
    expect(snapshotComparator).toContain('const recomputableMetrics = [');
    for (const metric of [
      'verifiedAttempts',
      'completedReferrals',
      'bonusAttempts',
      'trophies',
      'leagueTrophies',
      'achievements',
    ]) {
      expect(snapshotComparator).toMatch(new RegExp(`'${metric}'`));
    }
    expect(snapshotComparator).toContain(`${'${metric}'} (derived)`);
  });
});
