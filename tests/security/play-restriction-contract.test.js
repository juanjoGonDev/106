import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const competition = readFileSync('public/competition.js', 'utf8');
const playerContext = readFileSync('supabase/functions/player-context/index.ts', 'utf8');
const automaticBanMigration = readFileSync('supabase/migrations/20260810030000_ranked_integrity_policy_v3_bans.sql', 'utf8');
const manualBanMigration = readFileSync('supabase/migrations/20260810110000_zadmin_security_console.sql', 'utf8');

describe('ranked restriction public boundary', () => {
  it('reuses the canonical ranked restriction owners with the gameplay device and IP fingerprints', () => {
    expect(playerContext).toContain("'Access-Control-Allow-Headers': 'content-type, x-account-token, x-device-id'");
    expect(playerContext).toContain("sha256(`device:${deviceId}`)");
    expect(playerContext).toContain("sha256(`ip:${clientIp(request)}`)");
    expect(playerContext).toContain("rpc('get_game_active_integrity_ban', {");
    expect(playerContext).toContain("rpc('get_game_active_integrity_ban_by_token', {");
    expect(manualBanMigration).toContain('public.get_game_active_admin_ban_for_subject');
    expect(automaticBanMigration).toContain('public.get_game_active_integrity_ban_for_account');
    expect(competition).toContain("'x-device-id': deviceId");
  });

  it('returns a deliberately narrow public projection without detector evidence', () => {
    const projectionStart = playerContext.indexOf('function publicRestriction');
    const projectionEnd = playerContext.indexOf('async function effectiveRestriction');
    const projection = playerContext.slice(projectionStart, projectionEnd);
    expect(projection).toContain('active: true');
    expect(projection).toContain('source');
    expect(projection).toContain('scope');
    expect(projection).toContain('permanent');
    expect(projection).toContain('expiresAt');
    expect(projection).toContain('retryAfterSeconds');
    expect(projection).not.toMatch(/evidence|source_attempt|reason|device_hash|ip_hash/i);
  });

  it('keeps the start action gated while the server restriction remains active', () => {
    expect(competition).toContain("context.restriction?.active !== true");
    expect(competition).toContain("startButton.textContent = 'Acceso bloqueado'");
    expect(competition).toContain('startButton.disabled = true');
    expect(competition).toContain("syncPlayerContext('restriction-expired')");
    expect(competition).toContain('restrictionRefreshPending = true');
    expect(competition).toContain('formatRestrictionCountdown(remaining)');
    expect(competition).toContain("panel.setAttribute('aria-live', 'polite')");
  });
});
