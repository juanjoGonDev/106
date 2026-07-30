import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationDirectory = 'supabase/migrations';
const dailyMigrationFiles = readdirSync(migrationDirectory)
  .filter((file) => /^20260727150\d{3}_.*\.sql$/.test(file))
  .sort();
const migration = dailyMigrationFiles
  .map((file) => readFileSync(join(migrationDirectory, file), 'utf8'))
  .join('\n');
const spainResetMigration = readFileSync(
  join(migrationDirectory, '20260731003000_spain_daily_reset.sql'),
  'utf8',
);
const lifetimeProfileMigration = readFileSync(
  join(migrationDirectory, '20260731020000_lifetime_profile_attempts.sql'),
  'utf8',
);
const attemptRefresh = readFileSync('public/attempt-refresh.js', 'utf8');
const ui = readFileSync('public/daily-attempt-ui.js', 'utf8');
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));

describe('daily attempt and account referral limits', () => {
  it('keeps the original rollout split into cohesive ordered stages', () => {
    expect(dailyMigrationFiles).toEqual([
      '20260727150000_daily_attempt_schema.sql',
      '20260727150050_daily_quota_defaults.sql',
      '20260727150100_daily_referral_limits.sql',
      '20260727150200_daily_challenge_start.sql',
      '20260727150300_daily_challenge_reservations.sql',
      '20260727150400_daily_attempt_finish.sql',
      '20260727150500_daily_profile_limits.sql',
      '20260727150600_verified_email_daily_entitlement.sql',
    ]);
  });

  it('pins global challenges and attempts to a quota day with forward Spain-time corrections', () => {
    expect(migration).toContain('add column if not exists quota_day date');
    expect(migration).toContain('game_challenges_global_quota_day_check');
    expect(migration).toContain('game_attempts_global_quota_day_check');
    expect(migration).toContain('attempt.quota_day = v_challenge.quota_day');
    expect(migration).toContain('challenge.quota_day = v_current_day');

    expect(spainResetMigration).toContain("p_at at time zone 'Europe/Madrid'");
    expect(spainResetMigration).toContain("timestamp at time zone 'Europe/Madrid'");
    expect(spainResetMigration).toContain('alter column quota_day set default public.game_server_day(clock_timestamp())');
    expect(spainResetMigration).toContain('set quota_day = public.game_server_day(started_at)');
    expect(spainResetMigration).toContain('set quota_day = public.game_server_day(created_at)');
    expect(spainResetMigration).toContain('where league_id is null');
    expect(spainResetMigration).not.toMatch(/update public\.game_(?:challenges|attempts)[\s\S]*where league_id is not null/i);
  });

  it('keeps lifetime profile attempts separate from the current-day quota overlay', () => {
    expect(lifetimeProfileMigration).toContain('public.get_game_player_profile_without_daily_limits(p_nick_key)');
    expect(lifetimeProfileMigration).toContain("'lifetimeAttemptsUsed'");
    expect(lifetimeProfileMigration).toContain("payload->>'attemptsUsed'");
    expect(lifetimeProfileMigration.indexOf("'lifetimeAttemptsUsed'"))
      .toBeLessThan(lifetimeProfileMigration.indexOf('public.get_game_daily_attempt_state'));
    expect(lifetimeProfileMigration).toContain('revoke all on function public.get_game_player_profile(text)');
    expect(lifetimeProfileMigration).toContain('grant execute on function public.get_game_player_profile(text)');
    expect(lifetimeProfileMigration).toContain('to service_role');
    expect(lifetimeProfileMigration).not.toMatch(/grant execute[\s\S]*to (anon|authenticated)/i);
  });

  it('serializes reservations, midnight activation and referral completion', () => {
    expect(migration).toContain("hashtextextended(v_challenge.nick_key || ':global', 106)");
    expect(migration).toContain("hashtextextended('referral-account:' || v_referred_account_id::text, 106)");
    expect(migration).toContain("hashtextextended('referral-complete:' || v_referred_account_id::text, 106)");
    expect(migration).toContain('game_referrals_one_eligible_account_idx');
    expect(migration).toContain('v_completed + v_active >= v_max_attempts');
  });

  it('derives account-wide referral and authentication bonuses with an absolute cap of ten', () => {
    expect(migration).toContain('least(5, public.game_account_completed_referrals(p_account_id))');
    expect(migration).toContain('public.game_account_referral_bonus(selected.account_id)');
    expect(migration).toContain('public.game_account_auth_daily_bonus(selected.account_id)');
    expect(migration).toContain("'auth_identity_daily_attempt'");
    expect(migration).toContain("'verified_email_daily_attempt'");
    expect(migration).toContain("'authRewardBonus', v_auth_bonus");
    expect(migration).toContain("'dailyLimitCeiling', 10");
    expect(migration).toContain("'maxAttempts', v_max_attempts");
    expect(migration).not.toMatch(/grant execute[\s\S]*to (anon|authenticated)/i);
  });

  it('keeps leagues outside the daily reset', () => {
    expect(migration).toContain('and (not v_is_global or attempt.quota_day = v_quota_day)');
    expect(migration).toContain('case when v_is_global then v_quota_day else null end');
    expect(migration).toContain("coalesce(v_challenge.league_id::text, 'global')");
  });

  it('ships the countdown UX and mandatory validation commands', () => {
    expect(ui).toContain("section.id = 'dailyLimitCard'");
    expect(ui).toContain("section.setAttribute('aria-labelledby', 'dailyLimitTitle')");
    expect(attemptRefresh).toContain("import('./daily-attempt-ui.js?v=20260731-spain-reset')");
    expect(ui).toContain("window.Minuto106Competition?.refresh?.('daily-limit-reset')");
    expect(packageJson.scripts['test:daily-attempts:coverage']).toContain('--test-coverage-branches=100');
    expect(packageJson.scripts['test:supabase']).toContain('test-daily-attempt-limits-local.mjs');
    expect(packageJson.scripts['test:supabase']).toContain('test-verified-email-daily-bonus-local.mjs');
  });
});
