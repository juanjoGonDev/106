import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migrationPath = 'supabase/migrations/20260730170000_account_daily_attempt_policy.sql';

function compact(path) {
  return readFileSync(path, 'utf8').replaceAll(/\s+/g, ' ').toLowerCase();
}

describe('account daily attempt policy', () => {
  it('calculates account bonuses once and reuses them for player quota', () => {
    const sql = compact(migrationPath);

    expect(sql).toContain('create or replace function public.game_account_daily_bonus(p_account_id uuid)');
    expect(sql).toContain('greatest(0, public.game_account_referral_bonus(v_account_id)) + greatest(0, public.game_account_auth_daily_bonus(v_account_id))');
    expect(sql).toContain('create or replace function public.get_game_account_daily_attempt_policy(');
    expect(sql).toContain('v_bonus := public.game_account_daily_bonus(v_account_id)');
    expect(sql).toContain('create or replace function public.get_game_auth_daily_attempt_policy(');
    expect(sql).toContain('return public.get_game_account_daily_attempt_policy(v_account_id, p_at)');
    expect(sql).toContain('create or replace function public.get_game_account_daily_attempt_policy_by_token(');
    expect(sql).toContain('v_account_id := public.resolve_game_account_token(p_account_token_hash)');
    expect(sql).toContain('public.game_account_daily_bonus(selected.account_id) + greatest(0, legacy.total_bonus - legacy.historical_referral_bonus)');
    expect(sql).toContain('v_policy jsonb := public.get_game_account_daily_attempt_policy(v_account_id, p_at)');
    expect(sql).toContain("'attemptsleft', 5 + v_bonus");
    expect(sql).toContain("'maxattempts', 5 + v_bonus");
    expect(sql).toContain("'dailylimitceiling', 10");
  });

  it('keeps all policy functions service-role only', () => {
    const sql = compact(migrationPath);
    for (const signature of [
      'public.game_account_daily_bonus(uuid)',
      'public.get_game_account_daily_attempt_policy(uuid, timestamptz)',
      'public.get_game_auth_daily_attempt_policy(uuid, timestamptz)',
      'public.get_game_account_daily_attempt_policy_by_token(text, timestamptz)',
      'public.game_player_daily_bonus(text)',
      'public.get_game_daily_attempt_state(text, timestamptz)',
    ]) {
      expect(sql).toContain(`revoke all on function ${signature} from public, anon, authenticated`);
      expect(sql).toContain(`grant execute on function ${signature} to service_role`);
    }
  });

  it('exposes and refreshes the durable policy through every account boundary', () => {
    const accountAuth = readFileSync('supabase/functions/account-auth/index.ts', 'utf8');
    const playerContext = readFileSync('supabase/functions/player-context/index.ts', 'utf8');
    const cloudService = readFileSync('public/cloud-account-service.js', 'utf8');
    const competition = readFileSync('public/competition.js', 'utf8');

    expect(accountAuth).toContain("rpc('get_game_auth_daily_attempt_policy'");
    expect(accountAuth.match(/dailyAttemptPolicy:/g)).toHaveLength(3);
    expect(playerContext).toContain("'account-context'");
    expect(playerContext).toContain("rpc('get_game_account_daily_attempt_policy_by_token'");
    expect(playerContext).toContain('dailyAttemptPolicy: await accountDailyAttemptPolicy(request)');
    expect(cloudService).toContain('this.access.setAccountSession(accountToken, policy)');
    expect(cloudService).toContain('this.access?.setAccountDailyAttemptPolicy?.(policy)');
    expect(competition).toContain("import { resolveDailyAttemptState } from './daily-attempt-limit.js?v=20260802-derived-budget';");
    expect(competition).toContain('resolveDailyAttemptState(context.profile, accountDailyAttemptPolicy())');
    expect(competition).toContain("return requestContext('account-context');");
    expect(competition).not.toMatch(/profile\?\.attempts(?:Left|Max).*\?\? 5/);
  });
});
