import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const spec = readFileSync('.agents/specs/2026-08-11-admin-restriction-nickname-management.md', 'utf8');
const migration = readFileSync('supabase/migrations/20260811133000_admin_restriction_nickname_management.sql', 'utf8');
const hardeningMigration = readFileSync('supabase/migrations/20260811133200_admin_restriction_nickname_hardening.sql', 'utf8');
const guardMigration = readFileSync('supabase/migrations/20260811133100_required_nickname_account_guard.sql', 'utf8');
const adminEdge = readFileSync('supabase/functions/zadmin-management/index.ts', 'utf8');
const playerEdge = readFileSync('supabase/functions/player-name-management/index.ts', 'utf8');
const managementHtml = readFileSync('public/zadmin/management.html', 'utf8');
const managementClient = readFileSync('public/zadmin/management.js', 'utf8');
const requirementClient = readFileSync('public/nickname-requirement.js', 'utf8');
const accessClient = readFileSync('public/access.js', 'utf8');

function functionBody(source, name) {
  const pattern = new RegExp(`create or replace function public\\.${name}\\([^]*?\\n\\$\\$;`, 'gi');
  return [...source.matchAll(pattern)].at(-1)?.[0] ?? '';
}

describe('stable player identity and nickname moderation', () => {
  it('introduces a stable player id while retaining the legacy nickname compatibility projection', () => {
    expect(migration).toContain('add column if not exists player_id uuid');
    expect(migration).toContain('create unique index if not exists game_players_player_id_key');
    expect(migration).toContain('add column if not exists player_id uuid');
    expect(migration).toContain('game_account_players_player_id_fkey');
    expect(migration).toContain('alter constraint game_player_bonus_nick_key_fkey deferrable initially immediate');
    expect(migration).toContain('alter constraint game_account_players_nick_key_fkey deferrable initially immediate');
    expect(migration).not.toMatch(/execute\s+format/i);
    expect(migration).not.toMatch(/drop\s+column\s+nick_key/i);
  });

  it('renames through one transactional owner and preserves the stable player id', () => {
    const rename = functionBody(migration, 'rename_game_player_identity_internal');
    expect(rename).toContain("pg_advisory_xact_lock(hashtextextended('player-id:' || p_player_id::text, 0))");
    expect(rename).toContain('set constraints all deferred');
    expect(rename).toContain('where player_id = p_player_id');
    expect(rename).toContain("update public.game_attempts");
    expect(rename).toContain("update public.game_challenges");
    expect(rename).toContain("update public.game_admin_bans");
    expect(rename).toContain("return jsonb_build_object('error', 'nickname_taken')");
    expect(rename).not.toMatch(/update\s+public\.game_players\s+set\s+player_id/i);
  });

  it('keeps forced rename state private, account-owned and auditable', () => {
    expect(migration).toContain('create table if not exists public.game_player_name_requirements');
    expect(migration).toContain('create table if not exists public.game_admin_nickname_actions');
    expect(migration).toContain('game_admin_nickname_actions_append_only');
    expect(hardeningMigration).toContain("return jsonb_build_object('error', 'player_unlinked')");
    const complete = functionBody(migration, 'complete_game_player_required_rename');
    expect(complete).toContain('account_player.player_id = p_player_id');
    expect(complete).toContain("return jsonb_build_object('error', 'player_access_denied')");
    expect(complete).toContain("'resolve_change'");
  });

  it('blocks normal account/player authorization while a rename is required', () => {
    const wrapper = functionBody(guardMigration, 'ensure_game_account_player');
    expect(guardMigration).toContain('ensure_game_account_player_without_name_requirement');
    expect(wrapper).toContain('game_player_name_requirements');
    expect(wrapper).toContain("'error', 'nickname_change_required'");
    expect(wrapper).toContain('ensure_game_account_player_without_name_requirement');
  });
});

describe('automatic restriction administration', () => {
  it('preserves the original policy-v3 ban and overlays append-only lift/reinstate actions', () => {
    expect(migration).toContain('create table if not exists public.game_integrity_ban_admin_actions');
    expect(migration).toContain("action text not null check (action in ('lift', 'reinstate'))");
    expect(migration).toContain('game_integrity_ban_admin_actions_append_only');
    expect(migration).not.toMatch(/delete\s+from\s+public\.game_integrity_bans/i);
    expect(migration).not.toMatch(/update\s+public\.game_integrity_bans/i);
  });

  it('changes canonical enforcement rather than only hiding the ban in zadmin', () => {
    const lookup = functionBody(migration, 'get_game_active_integrity_ban_for_account');
    const mutate = functionBody(migration, 'zadmin_set_integrity_ban_action');
    expect(lookup).toContain("public.game_integrity_ban_admin_state(ban.id) <> 'lift'");
    expect(mutate).toContain("v_action not in ('lift', 'reinstate')");
    expect(mutate).toContain("return jsonb_build_object('error', 'ban_expired')");
    expect(mutate).toContain("'lift_integrity'");
    expect(mutate).toContain("'reinstate_integrity'");
  });

  it('keeps service-role table access consistent while append-only triggers enforce immutability', () => {
    expect(hardeningMigration).toContain('grant select, insert, update, delete on table');
    expect(hardeningMigration).toContain('public.game_integrity_ban_admin_actions');
    expect(hardeningMigration).toContain('public.game_admin_nickname_actions');
    expect(migration).toContain('before update or delete on public.game_integrity_ban_admin_actions');
    expect(migration).toContain('before update or delete on public.game_admin_nickname_actions');
  });
});

describe('management API and frontend safety', () => {
  it('uses the existing server-validated zadmin session and exposes manual plus automatic management actions', () => {
    expect(adminEdge).toContain("bearerTokenFromHeader(request.headers.get('authorization'))");
    expect(adminEdge).toContain("rpc('zadmin_validate_session'");
    expect(adminEdge).toContain(".from('game_integrity_bans')");
    expect(adminEdge).toContain(".from('game_admin_bans')");
    expect(adminEdge).toContain("action === 'revoke-manual-restriction'");
    expect(adminEdge).toContain("action === 'lift-integrity-restriction'");
    expect(adminEdge).toContain("action === 'reinstate-integrity-restriction'");
    expect(adminEdge).toContain("action === 'rename-player'");
    expect(adminEdge).toContain("action === 'require-player-rename'");
  });

  it('does not claim to send moderation email without a verified transactional sender', () => {
    expect(spec).toContain('does **not** claim an email was sent');
    expect(adminEdge).not.toMatch(/send(email|mail)|resend|smtp|magic.?link|recovery/i);
    expect(managementClient).toContain('todavía no hay sender transaccional de moderación');
  });

  it('uses application-owned inline admin actions and no browser-native dialogs', () => {
    expect(managementHtml).toContain('data-management-panel="restrictions"');
    expect(managementHtml).toContain('data-management-panel="players"');
    expect(managementClient).toContain("textContent: 'Quitar restricción'");
    expect(managementClient).toContain("textContent: 'Restaurar restricción'");
    expect(managementClient).toContain("textContent: 'Renombrar ahora'");
    expect(managementClient).toContain("textContent: player.renameRequired ? 'Reiniciar cambio obligatorio' : 'Forzar cambio de nick'");
    for (const source of [managementHtml, managementClient]) {
      expect(source).not.toMatch(/window\.(alert|confirm|prompt)\s*\(/);
      expect(source).not.toMatch(/<dialog\b/i);
      expect(source).not.toMatch(/showModal\s*\(/);
    }
  });

  it('keeps the player-facing required rename component account-token bound and app-owned', () => {
    expect(playerEdge).toContain("request.headers.get('x-account-token')");
    expect(playerEdge).toContain("rpc('get_game_account_nickname_requirement'");
    expect(playerEdge).toContain("rpc('complete_game_player_required_rename'");
    expect(requirementClient).toContain("card.setAttribute('role', 'dialog')");
    expect(requirementClient).toContain("card.setAttribute('aria-modal', 'true')");
    expect(requirementClient).toContain("setBackgroundInert(true)");
    expect(requirementClient).toContain("event.key !== 'Tab'");
    expect(requirementClient).not.toMatch(/document\.createElement\(['"]dialog['"]\)/);
    expect(requirementClient).not.toMatch(/window\.(alert|confirm|prompt)\s*\(/);
    expect(requirementClient).not.toMatch(/showModal\s*\(/);
    expect(accessClient).toContain("const ACCESS_ASSET_BASE = String(document.currentScript?.src || '').replace(/[^/]*$/, '') || './'");
    expect(accessClient).toContain("script.src = `${ACCESS_ASSET_BASE}nickname-requirement.js?v=202608111333`");
    expect(accessClient).toContain("code === 'nickname_change_required'");
  });
});
