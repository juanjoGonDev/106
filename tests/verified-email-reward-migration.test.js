import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const baseMigrationPath = 'supabase/migrations/20260727120300_verified_email_reward.sql';
const providerMigrationPath = 'supabase/migrations/20260727120400_auth_provider_rewards.sql';

function normalized(path) {
  return readFileSync(path, 'utf8').replaceAll(/\s+/g, ' ').toLowerCase();
}

describe('authentication reward migrations', () => {
  it('keeps the entitlement private, canonical and idempotent', () => {
    const baseSql = normalized(baseMigrationPath);
    const providerSql = normalized(providerMigrationPath);

    expect(baseSql).toContain('create table if not exists public.game_account_entitlements');
    expect(baseSql).toContain('primary key (account_id, entitlement_code)');
    expect(providerSql).toContain("'auth_identity_daily_attempt'");
    expect(providerSql).toContain('public.resolve_game_account_id(entitlement.account_id) = v_account_id');
    expect(providerSql).toContain("perform pg_advisory_xact_lock(hashtextextended('auth-reward:' || v_account_id::text, 106))");
    expect(providerSql).toContain('on conflict (account_id, entitlement_code) do nothing');
    expect(providerSql).toContain('revoke all on function public.grant_game_auth_link_reward(uuid) from public, anon, authenticated');
    expect(providerSql).toContain('grant execute on function public.grant_game_auth_link_reward(uuid) to service_role');
    expect(baseSql).toContain('revoke all on table public.game_account_entitlements from public, anon, authenticated');
    expect(baseSql).toContain('grant all on table public.game_account_entitlements to service_role');
  });

  it('grants exactly one mutually exclusive email or social reward', () => {
    const sql = normalized(providerMigrationPath);

    expect(sql).toContain("v_origin_provider = 'email' and v_origin.email_verified_at is null");
    expect(sql).toContain("v_source := 'email_confirmation'");
    expect(sql).toContain("v_origin_provider in ('google', 'facebook')");
    expect(sql).toContain("v_source := 'social_link'");
    expect(sql).toContain("'email_verified', 'email_verified', 'cuenta confirmada'");
    expect(sql).toContain("entitlement.metadata->>'source' = 'email_confirmation'");
    expect(sql).toContain('on conflict (nick_key, achievement_code) do nothing');
    expect(sql).toContain('after insert or update of account_id on public.game_account_players');
    expect(sql).toContain('origin_provider = coalesce(identity.origin_provider, p_provider)');
  });

  it('pins local activation links to one hour and highlights the reward in the email', () => {
    const config = readFileSync('supabase/config.toml', 'utf8');
    const template = readFileSync('supabase/templates/confirmation.html', 'utf8');

    expect(config).toContain('otp_expiry = 3600');
    expect(config).toContain('max_frequency = "1m"');
    expect(config).toContain('enable_confirmations = true');
    expect(config).toContain('content_path = "./supabase/templates/confirmation.html"');
    expect(template).toContain('+1 intento diario');
    expect(template).toContain('caduca en <strong>1 hora</strong>');
    expect(template).toContain('{{ .ConfirmationURL }}');
  });
});
