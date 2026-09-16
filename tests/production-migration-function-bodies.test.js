import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  migrationExecutionSql,
  migrationViolations,
} from '../scripts/check-production-migrations.mjs';

const temporaryDirectories = [];
const authProviderRewardsMigration = 'supabase/migrations/20260727120400_auth_provider_rewards.sql';
const zadminAttemptReviewMigration = 'supabase/migrations/20260810183000_zadmin_attempt_review_risk_scoring.sql';
const entitlementConsolidationApproval = '-- production-data-loss-approved: remove only a duplicate legacy entitlement after its canonical equivalent exists';

function migration(content) {
  const directory = mkdtempSync(join(tmpdir(), 'minuto106-migration-'));
  temporaryDirectories.push(directory);
  const path = join(directory, '20260727120000_example.sql');
  writeFileSync(path, content, 'utf8');
  return path;
}

afterEach(() => {
  while (temporaryDirectories.length) rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
});

describe('production migration runtime function filtering', () => {
  it('omits runtime PL/pgSQL and SQL function bodies from deployment-time checks', () => {
    const sql = `
      create or replace function public.remove_invalid_reward()
      returns integer language plpgsql as $$
      begin
        delete from public.game_player_achievements where false;
        return 0;
      end;
      $$;
      create function public.remove_invalid_trophy()
      returns integer language sql as $body$
        delete from public.game_league_trophies where false returning 1;
      $body$;
    `;

    const executable = migrationExecutionSql(sql);
    expect(executable).not.toContain('game_player_achievements');
    expect(executable).not.toContain('game_league_trophies');
    expect(migrationViolations([migration(sql)])).toEqual([]);
  });

  it('still detects destructive top-level statements and destructive DO blocks', () => {
    expect(migrationViolations([migration('delete from public.game_attempts;')])).toEqual([
      expect.stringContaining('DELETE FROM'),
    ]);
    expect(migrationViolations([migration(`
      do $$
      begin
        delete from public.game_attempts;
      end;
      $$;
    `)])).toEqual([
      expect.stringContaining('DELETE FROM'),
    ]);
  });

  it('keeps explicit production-data-loss approval behavior', () => {
    expect(migrationViolations([migration(`
      -- production-data-loss-approved: reviewed one-off cleanup
      delete from public.game_attempts;
    `)])).toEqual([]);
  });

  it('approves only the reviewed duplicate entitlement consolidation in the real migration', () => {
    const sql = readFileSync(authProviderRewardsMigration, 'utf8');
    const executionSql = migrationExecutionSql(sql);
    const unapprovedSql = sql.replace(entitlementConsolidationApproval, '');

    expect(sql).toContain(entitlementConsolidationApproval);
    expect(executionSql.indexOf(entitlementConsolidationApproval)).toBeLessThan(
      executionSql.indexOf('delete from public.game_account_entitlements legacy'),
    );
    expect(executionSql.match(/^\s*delete\s+from\b/gim)).toHaveLength(1);
    expect(migrationViolations([migration(unapprovedSql)])).toEqual([
      expect.stringContaining('DELETE FROM'),
    ]);
    expect(migrationViolations([authProviderRewardsMigration])).toEqual([]);
  });

  it('accepts only complete same-table same-name CHECK constraint replacements', () => {
    const achievementExpansion = `
      alter table public.game_player_achievements
        drop constraint if exists game_player_achievements_achievement_kind_check;
      alter table public.game_player_achievements
        add constraint game_player_achievements_achievement_kind_check
        check (achievement_kind in ('legacy', 'verified'));
    `;
    const multipleSafeReplacements = `
      alter table public.audit_events
        drop constraint if exists audit_events_action_check;
      alter table public.audit_events
        add constraint audit_events_action_check
        check (action in ('ban', 'review'));
      alter table public.audit_events
        drop constraint if exists audit_events_scope_check;
      alter table public.audit_events
        add constraint audit_events_scope_check
        check (scope in ('account', 'attempt'));
    `;

    expect(migrationViolations([migration(achievementExpansion)])).toEqual([]);
    expect(migrationViolations([migration(multipleSafeReplacements)])).toEqual([]);
    expect(migrationViolations([migration(`
      alter table public.audit_events
        drop constraint if exists audit_events_action_check;
    `)])).toEqual([expect.stringContaining('ALTER TABLE ... DROP')]);
    expect(migrationViolations([migration(`
      alter table public.audit_events
        drop constraint if exists audit_events_action_check;
      alter table public.audit_events
        add constraint audit_events_action_check unique (action);
    `)])).toEqual([expect.stringContaining('ALTER TABLE ... DROP')]);
    expect(migrationViolations([migration(`
      alter table public.audit_events
        drop constraint if exists audit_events_action_check;
      alter table public.other_events
        add constraint audit_events_action_check
        check (action in ('ban', 'review'));
    `)])).toEqual([expect.stringContaining('ALTER TABLE ... DROP')]);
    expect(migrationViolations([migration(`
      ${multipleSafeReplacements}
      alter table public.audit_events
        drop column legacy_payload;
    `)])).toEqual([expect.stringContaining('ALTER TABLE ... DROP')]);
  });

  it('accepts the real zadmin audit CHECK expansions without a data-loss approval', () => {
    const sql = readFileSync(zadminAttemptReviewMigration, 'utf8');
    const executionSql = migrationExecutionSql(sql).toLowerCase();

    expect(executionSql).toContain(
      'drop constraint if exists game_admin_audit_events_action_check;',
    );
    expect(executionSql).toContain(
      'add constraint game_admin_audit_events_action_check',
    );
    expect(executionSql).toContain(
      'drop constraint if exists game_admin_audit_events_target_scope_check;',
    );
    expect(executionSql).toContain(
      'add constraint game_admin_audit_events_target_scope_check',
    );
    expect(migrationViolations([zadminAttemptReviewMigration])).toEqual([]);
  });

  it('handles empty input deterministically', () => {
    expect(migrationExecutionSql()).toBe('');
    expect(migrationExecutionSql(null)).toBe('');
  });
});
