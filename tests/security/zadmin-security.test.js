import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const spec = readFileSync('.agents/specs/2026-08-10-zadmin-security-console.md', 'utf8');
const html = readFileSync('public/zadmin/index.html', 'utf8');
const client = readFileSync('public/zadmin/zadmin.js', 'utf8');
const edge = readFileSync('supabase/functions/zadmin-api/index.ts', 'utf8');
const core = readFileSync('supabase/functions/_shared/zadmin-core.js', 'utf8');
const migration = readFileSync('supabase/migrations/20260810110000_zadmin_security_console.sql', 'utf8');
const retryMigration = readFileSync('supabase/migrations/20260810110100_zadmin_login_retry_window.sql', 'utf8');
const nullableAccountMigration = readFileSync('supabase/migrations/20260810110200_zadmin_nullable_account_ban_lookup.sql', 'utf8');
const unlinkedNickMigration = readFileSync('supabase/migrations/20260810110300_zadmin_unlinked_nick_bans.sql', 'utf8');
const effectiveMigration = [migration, retryMigration, nullableAccountMigration, unlinkedNickMigration].join('\n');
const supabaseConfig = readFileSync('supabase/config.toml', 'utf8');
const deployWorkflow = readFileSync('.github/workflows/supabase.yml', 'utf8');

function functionBody(source, name) {
  const pattern = new RegExp(`create or replace function public\\.${name}\\([^]*?\\n\\$\\$;`, 'gi');
  return [...source.matchAll(pattern)].at(-1)?.[0] ?? '';
}

describe('zadmin frontend isolation', () => {
  it('is deploy-base-safe and remains standalone without product navigation', () => {
    expect(html).toContain('<script type="module" src="./zadmin.js"></script>');
    expect(html).toContain('<script src="../config.js"></script>');
    expect(html).toContain('<script type="module" src="../password-visibility.js"></script>');
    expect(html).toContain('<link rel="stylesheet" href="../styles.css">');
    expect(html).toContain('<link rel="stylesheet" href="./zadmin/zadmin.css">'.replace('/zadmin', ''));
    expect(html).toContain('<link rel="stylesheet" href="./zadmin-state.css">');
    expect(html).toContain('<form id="adminLoginForm" action="./" method="post" novalidate>');
    expect(html).not.toMatch(/<input id="adminUsername"[^>]*\bname=/);
    expect(html).not.toMatch(/<input id="adminPassword"[^>]*\bname=/);
    expect(html).not.toMatch(/(?:src|href)="\/(?:assets\/|styles\.css|config\.js|password-visibility\.js|zadmin\/)/);

    const projectBase = new URL('https://example.test/106/zadmin/');
    expect(new URL('../assets/favicon.svg', projectBase).pathname).toBe('/106/assets/favicon.svg');
    expect(new URL('../styles.css', projectBase).pathname).toBe('/106/styles.css');
    expect(new URL('./zadmin.css', projectBase).pathname).toBe('/106/zadmin/zadmin.css');
    expect(new URL('./zadmin-state.css', projectBase).pathname).toBe('/106/zadmin/zadmin-state.css');
    expect(new URL('../config.js', projectBase).pathname).toBe('/106/config.js');
    expect(new URL('../password-visibility.js', projectBase).pathname).toBe('/106/password-visibility.js');
    expect(new URL('./zadmin.js', projectBase).pathname).toBe('/106/zadmin/zadmin.js');
    expect(new URL('./', projectBase).pathname).toBe('/106/zadmin/');

    expect(html).toContain('name="robots" content="noindex,nofollow,noarchive"');
    expect(html).not.toContain('layout.js');
    expect(html).not.toContain('site-header');
    expect(html).not.toContain('site-footer');
    expect(spec).toContain('absent from normal navigation/layout');
  });

  it('never embeds the configured admin credentials or persists the session token', () => {
    expect(html).not.toMatch(/ZU_ADMIN_(USER|PSW)/);
    expect(client).not.toMatch(/ZU_ADMIN_(USER|PSW)/);
    expect(client).toContain("let sessionToken = '';");
    expect(client).toContain("const DEVICE_STORAGE_KEY = 'minuto106.zadmin.device.v1'");
    expect(client).toContain('localStorage.setItem(DEVICE_STORAGE_KEY, generated)');
    expect(client).not.toMatch(/localStorage\.setItem\([^\n]*(session|token)/i);
    expect(client).not.toMatch(/sessionStorage\.setItem/i);
    expect(client).not.toMatch(/indexedDB/i);
  });

  it('uses text nodes rather than injecting investigation data as HTML', () => {
    expect(client).not.toMatch(/\.innerHTML\s*=/);
    expect(client).not.toMatch(/insertAdjacentHTML/);
    expect(client).toContain('pre.textContent = JSON.stringify');
  });
});

describe('zadmin authentication and brute-force boundary', () => {
  it('reads credentials only from server environment and compares hashed domains', () => {
    expect(edge).toContain("Deno.env.get('ZU_ADMIN_USER')");
    expect(edge).toContain("Deno.env.get('ZU_ADMIN_PSW')");
    expect(edge).toContain('adminCredentialsMatch({');
    expect(core).toContain("pepperedDigest(username, pepper, 'zadmin-user')");
    expect(core).toContain("pepperedDigest(password, pepper, 'zadmin-password')");
    expect(core).toContain('fixedLengthHexEqual');
    expect(edge).toContain("error: 'Credenciales no válidas.'");
    expect(edge).not.toMatch(/console\.(log|error)[^\n]*(username|password|sessionToken|authorization)/i);
  });

  it('fails production deployment closed when either GitHub Actions secret is absent', () => {
    expect(deployWorkflow).toContain('ZU_ADMIN_USER: ${{ secrets.ZU_ADMIN_USER }}');
    expect(deployWorkflow).toContain('ZU_ADMIN_PSW: ${{ secrets.ZU_ADMIN_PSW }}');
    expect(deployWorkflow).toContain("test -n \"$ZU_ADMIN_USER\" || (echo 'Missing ZU_ADMIN_USER secret' && exit 1)");
    expect(deployWorkflow).toContain("test -n \"$ZU_ADMIN_PSW\" || (echo 'Missing ZU_ADMIN_PSW secret' && exit 1)");
    expect(deployWorkflow).toContain('"ZU_ADMIN_USER=$ZU_ADMIN_USER"');
    expect(deployWorkflow).toContain('"ZU_ADMIN_PSW=$ZU_ADMIN_PSW"');
    expect(deployWorkflow).toContain('supabase secrets set "${secrets[@]}" --project-ref "$PROJECT_ID"');
  });

  it('enforces independent rolling IP and device limits transactionally', () => {
    const gate = functionBody(effectiveMigration, 'zadmin_login_gate');
    expect(gate).toContain("v_window_start timestamptz := v_now - interval '1 hour'");
    expect(gate).toContain('where ip_hash = p_ip_hash');
    expect(gate).toContain('where device_hash = p_device_hash');
    expect(gate).toContain('v_ip_count >= 3 or v_device_count >= 3');
    expect(gate).toContain("hashtextextended('zadmin:ip:' || p_ip_hash, 0)");
    expect(gate).toContain("hashtextextended('zadmin:device:' || p_device_hash, 0)");
    expect(gate).toContain('pg_advisory_xact_lock');
    expect(gate).toContain("case when v_ip_count >= 3 then v_ip_oldest + interval '1 hour'");
    expect(gate).toContain("case when v_device_count >= 3 then v_device_oldest + interval '1 hour'");
    expect(edge).toContain("'Retry-After': String(retryAfter)");
  });

  it('does not let valid credentials bypass an already active rate-limit block', () => {
    const gate = functionBody(effectiveMigration, 'zadmin_login_gate');
    expect(gate.indexOf('if v_ip_count >= 3 or v_device_count >= 3 then')).toBeGreaterThan(-1);
    expect(gate.indexOf('if coalesce(p_credentials_valid, false) then')).toBeGreaterThan(-1);
    expect(gate.indexOf('if v_ip_count >= 3 or v_device_count >= 3 then')).toBeLessThan(gate.indexOf('if coalesce(p_credentials_valid, false) then'));
  });

  it('uses random memory-only sessions stored as hashes and bound to IP plus device', () => {
    expect(edge).toContain('const sessionToken = randomHex()');
    expect(edge).toContain("pepperedDigest(sessionToken, hashPepper, 'zadmin-session')");
    expect(edge).toContain("bearerTokenFromHeader(request.headers.get('authorization'))");
    const createSession = functionBody(effectiveMigration, 'zadmin_create_session');
    const validateSession = functionBody(effectiveMigration, 'zadmin_validate_session');
    expect(createSession).toContain("v_now + interval '30 minutes'");
    expect(validateSession).toContain('and ip_hash = p_ip_hash');
    expect(validateSession).toContain('and device_hash = p_device_hash');
    expect(validateSession).toContain('and revoked_at is null');
    expect(validateSession).toContain('and expires_at > v_now');
  });

  it('bounds origins, body size and malformed input before privileged actions', () => {
    expect(edge).toContain('if (origin && !allowedOrigins.has(origin))');
    expect(edge).toContain('declaredLength > ZADMIN_MAX_BODY_BYTES');
    expect(edge).toContain("new TextEncoder().encode(source).byteLength > ZADMIN_MAX_BODY_BYTES");
    expect(edge).toContain("return jsonResponse(origin, { error: 'Invalid JSON body.' }, 400)");
    expect(edge).toContain("normalizeAdminDeviceId(request.headers.get('x-device-id'))");
    expect(edge).toContain("'Cache-Control': 'no-store'");
    expect(edge).toContain("'Referrer-Policy': 'no-referrer'");
  });
});

describe('zadmin data and ban authorization', () => {
  it('keeps admin tables and investigation facts private from browser roles', () => {
    for (const table of ['game_admin_login_failures', 'game_admin_sessions', 'game_admin_bans', 'game_admin_audit_events']) {
      expect(migration).toContain(`alter table public.${table} enable row level security`);
    }
    expect(migration).toContain('from public, anon, authenticated, service_role');
    expect(migration).toContain('revoke all on table public.game_admin_attempt_facts from public, anon, authenticated');
    expect(migration).toContain('grant select on table public.game_admin_attempt_facts to service_role');
    expect(migration).not.toMatch(/grant\s+(select|insert|update|delete)[^;]+\b(anon|authenticated)\b/i);
  });

  it('stores only hashed IP/device login subjects and reuses existing gameplay fingerprints', () => {
    expect(migration).toContain('ip_hash text not null');
    expect(migration).toContain('device_hash text not null');
    expect(migration).not.toMatch(/\bip_address\b|\braw_ip\b/i);
    expect(migration).toContain('attempt.ip_hash');
    expect(migration).toContain('attempt.device_hash');
    expect(edge).toContain("pepperedDigest(ip, hashPepper, 'zadmin-ip')");
  });

  it('keeps manual operator bans separate, revocable and audited', () => {
    expect(migration).toContain('create table if not exists public.game_admin_bans');
    expect(migration).toContain("scope text not null check (scope in ('account', 'nick', 'ip'))");
    expect(migration).toContain('revoked_at timestamptz');
    expect(migration).toContain('revoked_by_session_id uuid');
    expect(migration).toContain('create table if not exists public.game_admin_audit_events');
    expect(migration).toContain("action text not null check (action in ('ban', 'revoke'))");
    expect(functionBody(effectiveMigration, 'zadmin_revoke_manual_ban')).not.toMatch(/delete\s+from\s+public\.game_admin_bans/i);
  });

  it('supports exactly hourly 1-24h, one week and permanent operator durations', () => {
    const createBan = functionBody(effectiveMigration, 'zadmin_create_manual_ban');
    expect(createBan).toContain('p_duration_minutes between 60 and 1440');
    expect(createBan).toContain('mod(p_duration_minutes, 60) = 0');
    expect(createBan).toContain('p_duration_minutes = 10080');
    expect(createBan).toContain('case when p_duration_minutes is null then null');
    expect(core).toContain('minutes >= 60 && minutes <= 1_440 && minutes % 60 === 0');
    expect(core).toContain('minutes === 10_080');
  });

  it('requires an active admin session, existing target and reason for every ban mutation', () => {
    const createBan = functionBody(effectiveMigration, 'zadmin_create_manual_ban');
    const revokeBan = functionBody(effectiveMigration, 'zadmin_revoke_manual_ban');
    expect(createBan).toContain('char_length(v_reason) not between 3 and 500');
    expect(createBan).toContain('session.expires_at > v_now');
    expect(createBan).toContain("return jsonb_build_object('error', 'target_not_found')");
    expect(createBan).toContain("return jsonb_build_object('error', 'ban_already_active'");
    expect(revokeBan).toContain('for update');
    expect(revokeBan).toContain("return jsonb_build_object('error', 'ban_already_revoked')");
  });

  it('allows a nick with real gameplay activity even when it is not account-linked', () => {
    const createBan = functionBody(effectiveMigration, 'zadmin_create_manual_ban');
    expect(createBan).toContain('from public.game_attempts attempt');
    expect(createBan).toContain('where attempt.nick_key = v_nick_key');
    expect(createBan).not.toContain('from public.game_account_players player where player.nick_key = v_nick_key');
  });

  it('keeps IP manual-ban lookup valid when no account can be resolved', () => {
    const lookup = functionBody(effectiveMigration, 'get_game_active_admin_ban_for_subject');
    expect(lookup).toContain('when p_account_id is null then null');
    expect(lookup).toContain("ban.scope = 'ip'");
  });

  it('extends the existing canonical ranked restriction lookup instead of bypassing policy v3', () => {
    const byNick = functionBody(effectiveMigration, 'get_game_active_integrity_ban');
    const byToken = functionBody(effectiveMigration, 'get_game_active_integrity_ban_by_token');
    expect(byNick).toContain('public.get_game_active_admin_ban_for_subject');
    expect(byNick).toContain('public.get_game_active_integrity_ban_for_account');
    expect(byToken).toContain('public.get_game_active_admin_ban_for_subject');
    expect(byToken).toContain('public.get_game_active_integrity_ban_for_account');
    expect(byNick.indexOf('get_game_active_admin_ban_for_subject')).toBeLessThan(byNick.indexOf('get_game_active_integrity_ban_for_account'));
    expect(byToken.indexOf('get_game_active_admin_ban_for_subject')).toBeLessThan(byToken.indexOf('get_game_active_integrity_ban_for_account'));
  });

  it('uses the existing integrity risk score as review evidence, not a fabricated cheating probability', () => {
    expect(migration).toContain('coalesce(integrity.risk_score, 0) as risk_score');
    expect(edge).toContain('aggregateIntegrityEntities');
    expect(edge).toContain('integrityDistribution');
    expect(html).toContain('No es una probabilidad estadística de trampa.');
    expect(spec).toContain('Do not invent a new statistical probability');
  });
});

describe('zadmin Edge registration', () => {
  it('registers the custom-auth function without exposing JWT as a fake authorization boundary', () => {
    expect(supabaseConfig).toContain('[functions.zadmin-api]\nverify_jwt = false');
    expect(edge).toContain('authenticatedSession(request, ipHash, deviceHash)');
  });
});
