import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migrationPath = 'supabase/migrations/20260727120300_verified_email_reward.sql';

describe('verified email reward migration', () => {
  it('keeps the reward private, idempotent and attached to the canonical account', () => {
    const sql = readFileSync(migrationPath, 'utf8').replaceAll(/\s+/g, ' ').toLowerCase();

    expect(sql).toContain('create table if not exists public.game_account_entitlements');
    expect(sql).toContain('primary key (account_id, entitlement_code)');
    expect(sql).toContain("entitlement.entitlement_code = 'verified_email_daily_attempt'");
    expect(sql).toContain('public.resolve_game_account_id(entitlement.account_id) = v_account_id');
    expect(sql).toContain("v_identity.provider <> 'email'");
    expect(sql).toContain('v_identity.email_verified_at is null');
    expect(sql).toContain("'email_verified', 'email_verified', 'cuenta confirmada'");
    expect(sql).toContain('on conflict (nick_key, achievement_code) do nothing');
    expect(sql).toContain('after insert or update of account_id on public.game_account_players');
    expect(sql).toContain('revoke all on table public.game_account_entitlements from public, anon, authenticated');
    expect(sql).toContain('grant all on table public.game_account_entitlements to service_role');
    expect(sql).toContain('revoke all on function public.grant_game_verified_email_reward(uuid) from public, anon, authenticated');
  });
});
