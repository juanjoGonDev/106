import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20260810030000_ranked_integrity_policy_v3_bans.sql', 'utf8');
const gameApi = readFileSync('supabase/functions/game-api/index.ts', 'utf8');
const readyApi = readFileSync('supabase/functions/game-ready-api/index.ts', 'utf8');
const playerHtml = readFileSync('public/player.html', 'utf8');
const playerJs = readFileSync('public/player.js', 'utf8');
const collectionState = readFileSync('public/profile-collection-state.js', 'utf8');
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));

function bodyOf(source, functionName) {
  const pattern = new RegExp(`create or replace function public\\.${functionName}\\([^]*?\\n\\$\\$;`, 'gi');
  return [...source.matchAll(pattern)].at(-1)?.[0] ?? '';
}

describe('ranked integrity policy v3', () => {
  it('uses a private append-only bounded ban ledger', () => {
    expect(migration).toContain('create table if not exists public.game_integrity_bans');
    expect(migration).toContain("scope text not null check (scope in ('account', 'device', 'ip'))");
    expect(migration).toContain("v_triggered_at + interval '48 hours'");
    expect(migration).toContain('alter table public.game_integrity_bans enable row level security');
    expect(migration).toContain('grant select, insert on table public.game_integrity_bans to service_role');
    expect(migration).not.toContain('grant update on table public.game_integrity_bans');
    expect(migration).not.toContain('grant delete on table public.game_integrity_bans');
  });

  it('evaluates the complete two-hour strong-identity sequence instead of consecutive results', () => {
    const evidence = bodyOf(migration, 'game_attempt_integrity_evidence');
    expect(evidence).toContain("v_session_start := v_anchor.created_at - interval '2 hours'");
    expect(evidence).toContain("attempt.difference_ms <= 5 as near_perfect");
    expect(evidence).toContain('lag(near_perfect) over(order by created_at, id)');
    expect(evidence).toContain('sessionNearOrdinarySwitches2h');
    expect(evidence).toContain('sessionFingerprintMatches2h');
    expect(evidence).toContain('sessionAutomationShape2h');
    expect(evidence).toContain('sessionIpDevices2h');
  });

  it('cannot convict from precision or IP alone and requires corroborated malicious evidence', () => {
    const decision = bodyOf(migration, 'game_attempt_integrity_decision');
    expect(decision).toContain('v_session_automation_malicious := v_session_near >= 3');
    expect(decision).toContain('and v_session_automation >= 3');
    expect(decision).toContain('and v_session_fingerprint >= 2');
    expect(decision).toContain('v_session_alternation_malicious := v_session_attempts >= 5');
    expect(decision).toContain('and v_session_ordinary >= 2');
    expect(decision).toContain('and v_session_switches >= 3');
    expect(decision).toContain('and v_session_fingerprint >= 3');
    expect(decision).toContain('v_malicious := v_score >= 65');
    expect(decision).toContain("if v_malicious and v_anchor_near then\n    v_status := 'excluded'");
  });

  it('revokes only suspicious two-hour strong-identity results and reuses canonical reward reconciliation', () => {
    const reassess = bodyOf(migration, 'reassess_game_integrity_cluster');
    expect(reassess).toContain("v_anchor.created_at - interval '2 hours'");
    expect(reassess).toContain('v_target.difference_ms <= 5');
    expect(reassess).toContain('v_target_account_id = v_anchor_account_id');
    expect(reassess).toContain("array['retroactive_two_hour_revocation']::text[]");
    expect(reassess).toContain('perform public.reconcile_game_integrity_attempts(v_changed_attempts)');
    expect(reassess).not.toMatch(/delete\s+from\s+public\.game_attempts/i);
  });

  it('issues account and device bans while suppressing IP bans on shared networks', () => {
    const reassess = bodyOf(migration, 'reassess_game_integrity_cluster');
    expect(reassess).toContain("'account', v_anchor_account_id");
    expect(reassess).toContain("'device', null, v_anchor.device_hash");
    expect(reassess).toContain("coalesce((v_evidence->>'sessionIpDevices2h')::integer, 0) <= 1");
    expect(reassess).toContain("'ip', null, null, v_anchor.ip_hash");
  });

  it('enforces active restrictions in Edge preflight and database start/finish paths', () => {
    const start = bodyOf(migration, 'start_game_challenge_pointer_only');
    const finish = bodyOf(migration, 'finish_game_attempt_pointer_only');
    expect(start).toContain('public.get_game_active_integrity_ban');
    expect(start).toContain("return jsonb_build_object('error', 'integrity_banned')");
    expect(finish).toContain('public.get_game_active_integrity_ban');
    expect(finish).toContain("return jsonb_build_object('error', 'integrity_banned')");

    const readyPreflight = readyApi.indexOf("if (['human-check', 'human-check-click', 'prepare-start', 'activate-start'].includes(action))");
    const turnstileVerify = readyApi.indexOf('turnstilePolicy.verify');
    const humanConsume = readyApi.indexOf("rpc('consume_game_human_check'");
    expect(readyPreflight).toBeGreaterThan(-1);
    expect(readyPreflight).toBeLessThan(turnstileVerify);
    expect(readyPreflight).toBeLessThan(humanConsume);

    const legacyPreflight = gameApi.indexOf("if (['human-check', 'complete-human-check', 'start'].includes(action))");
    const legacyTurnstile = gameApi.indexOf('if (!(await verifyTurnstile');
    expect(legacyPreflight).toBeGreaterThan(-1);
    expect(legacyTurnstile).toBeGreaterThan(-1);
    expect(legacyPreflight).toBeLessThan(legacyTurnstile);
    expect(gameApi).toContain("integrity_banned: 'El juego competitivo está bloqueado temporalmente");
    expect(readyApi).toContain("integrity_banned: 'El juego competitivo está bloqueado temporalmente");
  });

  it('performs one deterministic policy-v3 forward rebuild without a recurring full scan', () => {
    const rebuild = bodyOf(migration, 'rebuild_game_attempt_integrity');
    expect(rebuild).toContain("hashtextextended('minuto106:integrity-policy-v3', 106)");
    expect(rebuild).toContain("integrity.policy_version < 3");
    expect(rebuild).toContain("'policyVersion', 3");
    expect(migration.trimEnd()).toMatch(/select public\.rebuild_game_attempt_integrity\(true\);$/);
  });

  it('centralizes epic perfect-attempt points in the database', () => {
    const expected = [
      ["perfect_total_1", 100],
      ["perfect_total_3", 150],
      ["perfect_total_5", 225],
      ["perfect_total_10", 350],
      ["perfect_total_25", 650],
      ["perfect_total_50", 1000],
      ["perfect_total_100", 1600],
      ["perfect_average", 300],
    ];
    for (const [code, points] of expected) {
      expect(migration).toContain(`('${code}', ${points}, 3)`);
    }
    expect(migration).toContain('create trigger game_player_achievement_points');
    expect(migration).toContain('new.points := v_points');
  });
});

describe('bounded public profile collections', () => {
  it('loads the shared pagination owner before the player controller and provides all pager slots', () => {
    expect(playerHtml).toContain('profile-collection-state.js?v=20260810-profile-pagination');
    expect(playerHtml.indexOf('profile-collection-state.js')).toBeLessThan(playerHtml.indexOf('player.js?v=20260810-profile-pagination'));
    expect(playerHtml).toContain('id="playerHistoryPager"');
    expect(playerHtml).toContain('id="playerAchievementsPager"');
    expect(playerHtml).toContain('id="playerTrophiesPager"');
    expect(playerHtml).toContain('profile-pagination.css?v=20260810-profile-pagination');
  });

  it('paginates attempts, achievements and trophy history while grouping repeat dates in collapsed details', () => {
    expect(playerJs).toContain("collections.paginate(attempts, pages.history, PAGE_SIZE)");
    expect(playerJs).toContain("collections.paginate(visibleAchievements, pages.achievements, PAGE_SIZE)");
    expect(playerJs).toContain("collections.paginate(history, pages.trophies, PAGE_SIZE)");
    expect(playerJs).toContain('<details class="honours-occurrences">');
    expect(playerJs).not.toContain('<details class="honours-occurrences" open>');
    expect(collectionState).toContain("'daily_hat_trick'");
    expect(collectionState).toContain("'first_of_month'");
    expect(collectionState).toContain("'league_podium'");
  });

  it('enforces 100 percent coverage on the isolated pagination/grouping state owner', () => {
    expect(packageJson.scripts['test:profile-collections:coverage']).toContain('--test-coverage-lines=100');
    expect(packageJson.scripts['test:profile-collections:coverage']).toContain('--test-coverage-functions=100');
    expect(packageJson.scripts['test:profile-collections:coverage']).toContain('--test-coverage-branches=100');
    expect(packageJson.scripts.check).toContain('pnpm test:profile-collections:coverage');
  });
});
