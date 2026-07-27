import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migrationPath = 'supabase/migrations/20260727150600_verified_email_daily_entitlement.sql';

describe('verified email daily entitlement migration', () => {
  it('keeps one account-wide bonus inside the existing ceiling', () => {
    const sql = readFileSync(migrationPath, 'utf8').replaceAll(/\s+/g, ' ').toLowerCase();

    expect(sql).toContain('create table if not exists public.game_account_entitlements');
    expect(sql).toContain('primary key (account_id, entitlement_code)');
    expect(sql).toContain("entitlement.entitlement_code = 'verified_email_daily_attempt'");
    expect(sql).toContain('public.daily_game_account_id(entitlement.account_id) = public.daily_game_account_id(p_account_id)');
    expect(sql).toContain('+ public.game_account_verified_email_bonus(selected.account_id)');
    expect(sql).toContain('select least( 5,');
    expect(sql).toContain("'emailverificationbonus', v_email_bonus");
    expect(sql).toContain("'dailylimitceiling', 10");
    expect(sql).toContain('revoke all on table public.game_account_entitlements from public, anon, authenticated');
    expect(sql).toContain('revoke all on function public.game_account_verified_email_bonus(uuid) from public, anon, authenticated');
  });
});
