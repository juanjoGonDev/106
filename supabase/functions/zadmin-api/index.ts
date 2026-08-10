import { createClient } from 'npm:@supabase/supabase-js@2.95.0';
import {
  ZADMIN_MAX_BODY_BYTES,
  adminCredentialsMatch,
  aggregateIntegrityEntities,
  bearerTokenFromHeader,
  integrityDistribution,
  normalizeAdminDeviceId,
  normalizeAdminRangeDays,
  normalizeAdminScope,
  normalizeAdminSearch,
  parseBanDurationMinutes,
  pepperedDigest,
} from '../_shared/zadmin-core.js';

function resolveServiceKey() {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) return legacy;
  const raw = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (!raw) return undefined;
  try {
    const keys = JSON.parse(raw) as Record<string, string>;
    return keys.default ?? Object.values(keys)[0];
  } catch {
    return undefined;
  }
}

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const serviceKey = resolveServiceKey();
const hashPepper = Deno.env.get('HASH_PEPPER') ?? '';
const adminUser = Deno.env.get('ZU_ADMIN_USER') ?? '';
const adminPassword = Deno.env.get('ZU_ADMIN_PSW') ?? '';
const allowedOrigins = new Set(
  (Deno.env.get('ALLOWED_ORIGINS') ?? 'http://localhost:3000,http://127.0.0.1:3000,https://juanjogondev.github.io')
    .split(',').map((item) => item.trim()).filter(Boolean),
);

if (!supabaseUrl || !serviceKey || !hashPepper) {
  throw new Error('Missing required zadmin Edge Function environment variables.');
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/i;

function corsHeaders(origin: string | null) {
  return {
    'Access-Control-Allow-Origin': origin && allowedOrigins.has(origin) ? origin : [...allowedOrigins][0],
    'Access-Control-Allow-Headers': 'authorization, content-type, x-device-id',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

function jsonResponse(
  origin: string | null,
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
) {
  return Response.json(body, {
    status,
    headers: {
      ...corsHeaders(origin),
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders,
    },
  });
}

function clientIp(request: Request) {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('cf-connecting-ip')
    || request.headers.get('x-real-ip')
    || 'unknown';
}

function randomHex(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function logError(event: string, error: unknown) {
  console.error(JSON.stringify({
    source: 'server',
    level: 'error',
    event,
    message: error instanceof Error ? error.message.slice(0, 240) : 'Unknown zadmin error',
  }));
}

async function rpc(name: string, parameters = {}) {
  const { data, error } = await supabase.rpc(name, parameters);
  if (error) {
    logError(`zadmin.rpc.${name}`, error);
    throw new Error('Database operation failed');
  }
  return data;
}

async function subjectHashes(request: Request, deviceId: string) {
  const ip = clientIp(request);
  const [ipHash, deviceHash] = await Promise.all([
    pepperedDigest(ip, hashPepper, 'zadmin-ip'),
    pepperedDigest(deviceId, hashPepper, 'zadmin-device'),
  ]);
  return { ipHash, deviceHash };
}

async function authenticatedSession(request: Request, ipHash: string, deviceHash: string) {
  const rawToken = bearerTokenFromHeader(request.headers.get('authorization'));
  if (!rawToken) return null;
  const tokenHash = await pepperedDigest(rawToken, hashPepper, 'zadmin-session');
  const session = await rpc('zadmin_validate_session', {
    p_token_hash: tokenHash,
    p_ip_hash: ipHash,
    p_device_hash: deviceHash,
  });
  return session?.valid === true ? session : null;
}

function activeBan(ban: Record<string, unknown>, now = Date.now()) {
  if (ban.revoked_at) return false;
  if (!ban.expires_at) return true;
  const expiresAt = Date.parse(String(ban.expires_at));
  return Number.isFinite(expiresAt) && expiresAt > now;
}

function banTarget(ban: Record<string, unknown>) {
  if (ban.scope === 'account') return String(ban.account_id ?? '');
  if (ban.scope === 'nick') return String(ban.nick_key ?? '');
  return String(ban.ip_hash ?? '');
}

function validateDetailTarget(scope: string, value: unknown) {
  const target = String(value ?? '').trim();
  if (scope === 'account') return UUID.test(target) ? target : null;
  if (scope === 'ip') return HASH.test(target) ? target.toLowerCase() : null;
  return target && target.length <= 80 ? target.toLocaleLowerCase('es') : null;
}

async function fetchAttemptFacts(rangeDays: number) {
  const since = new Date(Date.now() - rangeDays * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from('game_admin_attempt_facts')
    .select('id,nick,nick_key,account_id,device_hash,ip_hash,difference_ms,verified,verification_reasons,created_at,integrity_status,risk_score,risk_reasons,integrity_evidence,integrity_policy_version,integrity_evaluated_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(2_000);
  if (error) {
    logError('zadmin.query.overview', error);
    throw new Error('Could not load integrity facts');
  }
  return Array.isArray(data) ? data : [];
}

async function fetchBans() {
  const { data, error } = await supabase
    .from('game_admin_bans')
    .select('id,scope,account_id,nick_key,ip_hash,reason,created_at,expires_at,revoked_at,revoked_reason')
    .order('created_at', { ascending: false })
    .limit(250);
  if (error) {
    logError('zadmin.query.bans', error);
    throw new Error('Could not load bans');
  }
  return Array.isArray(data) ? data : [];
}

async function overview(body: Record<string, unknown>) {
  const scope = normalizeAdminScope(body.scope) ?? 'account';
  const rangeDays = normalizeAdminRangeDays(body.rangeDays);
  const search = normalizeAdminSearch(body.search);
  const facts = await fetchAttemptFacts(rangeDays);
  const entities = aggregateIntegrityEntities(facts, scope, search).slice(0, 250);
  const bans = await fetchBans();
  const now = Date.now();
  const activeBans = bans.filter((ban) => activeBan(ban, now));

  return {
    scope,
    rangeDays,
    truncated: facts.length >= 2_000,
    summary: {
      attempts: facts.length,
      verifiedAttempts: facts.filter((row) => row.verified === true).length,
      watchAttempts: facts.filter((row) => row.integrity_status === 'watch').length,
      excludedAttempts: facts.filter((row) => row.integrity_status === 'excluded').length,
      distinctAccounts: new Set(facts.map((row) => row.account_id).filter(Boolean)).size,
      distinctNicks: new Set(facts.map((row) => row.nick_key).filter(Boolean)).size,
      distinctIps: new Set(facts.map((row) => row.ip_hash).filter(Boolean)).size,
      activeManualBans: activeBans.length,
    },
    entities,
  };
}

async function detail(body: Record<string, unknown>) {
  const scope = normalizeAdminScope(body.scope);
  if (!scope) return { error: 'invalid_scope' };
  const target = validateDetailTarget(scope, body.target);
  if (!target) return { error: 'invalid_target' };

  let query = supabase
    .from('game_admin_attempt_facts')
    .select('id,nick,nick_key,account_id,device_hash,ip_hash,difference_ms,verified,verification_reasons,created_at,integrity_status,risk_score,risk_reasons,integrity_evidence,integrity_policy_version,integrity_evaluated_at')
    .order('created_at', { ascending: false })
    .limit(200);
  if (scope === 'account') query = query.eq('account_id', target);
  else if (scope === 'ip') query = query.eq('ip_hash', target);
  else query = query.eq('nick_key', target);

  const [{ data: rows, error: rowsError }, bans] = await Promise.all([query, fetchBans()]);
  if (rowsError) {
    logError('zadmin.query.detail', rowsError);
    throw new Error('Could not load entity detail');
  }
  const facts = Array.isArray(rows) ? rows : [];
  const matchingBans = bans
    .filter((ban) => String(ban.scope) === scope && banTarget(ban) === target)
    .map((ban) => ({ ...ban, active: activeBan(ban) }));

  return {
    scope,
    target,
    summary: {
      attempts: facts.length,
      verifiedAttempts: facts.filter((row) => row.verified === true).length,
      watchAttempts: facts.filter((row) => row.integrity_status === 'watch').length,
      excludedAttempts: facts.filter((row) => row.integrity_status === 'excluded').length,
      maxRiskScore: facts.reduce((maximum, row) => Math.max(maximum, Number(row.risk_score) || 0), 0),
      distinctAccounts: new Set(facts.map((row) => row.account_id).filter(Boolean)).size,
      distinctNicks: new Set(facts.map((row) => row.nick_key).filter(Boolean)).size,
      distinctIps: new Set(facts.map((row) => row.ip_hash).filter(Boolean)).size,
      distinctDevices: new Set(facts.map((row) => row.device_hash).filter(Boolean)).size,
    },
    distribution: integrityDistribution(facts),
    correlations: {
      accounts: [...new Set(facts.map((row) => row.account_id).filter(Boolean))].slice(0, 50),
      nicks: [...new Set(facts.map((row) => row.nick_key).filter(Boolean))].slice(0, 50),
      ips: [...new Set(facts.map((row) => row.ip_hash).filter(Boolean))].slice(0, 50),
      devices: [...new Set(facts.map((row) => row.device_hash).filter(Boolean))].slice(0, 50),
    },
    attempts: facts,
    bans: matchingBans,
  };
}

async function listBans() {
  const bans = await fetchBans();
  return bans.map((ban) => ({ ...ban, target: banTarget(ban), active: activeBan(ban) }));
}

async function auditLog() {
  const { data, error } = await supabase
    .from('game_admin_audit_events')
    .select('id,action,target_scope,target_key,metadata,created_at')
    .order('created_at', { ascending: false })
    .limit(250);
  if (error) {
    logError('zadmin.query.audit', error);
    throw new Error('Could not load audit log');
  }
  return Array.isArray(data) ? data : [];
}

Deno.serve(async (request) => {
  const origin = request.headers.get('origin');
  if (request.method === 'OPTIONS') {
    if (origin && !allowedOrigins.has(origin)) return new Response(null, { status: 403 });
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (request.method !== 'POST') return jsonResponse(origin, { error: 'Method not allowed.' }, 405);
  if (origin && !allowedOrigins.has(origin)) return jsonResponse(origin, { error: 'Origin not allowed.' }, 403);

  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (declaredLength > ZADMIN_MAX_BODY_BYTES) return jsonResponse(origin, { error: 'Request too large.' }, 413);

  try {
    const source = await request.text();
    if (new TextEncoder().encode(source).byteLength > ZADMIN_MAX_BODY_BYTES) {
      return jsonResponse(origin, { error: 'Request too large.' }, 413);
    }
    let body: Record<string, unknown>;
    try {
      const parsed = JSON.parse(source || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid body');
      body = parsed as Record<string, unknown>;
    } catch {
      return jsonResponse(origin, { error: 'Invalid JSON body.' }, 400);
    }

    const action = String(body.action ?? '');
    const deviceId = normalizeAdminDeviceId(request.headers.get('x-device-id'));
    if (!deviceId) return jsonResponse(origin, { error: 'Invalid device identifier.' }, 400);
    const { ipHash, deviceHash } = await subjectHashes(request, deviceId);

    if (action === 'login') {
      if (!adminUser || !adminPassword) {
        return jsonResponse(origin, { error: 'Admin authentication is not configured.' }, 503);
      }
      const validCredentials = await adminCredentialsMatch({
        username: body.username,
        password: body.password,
        expectedUsername: adminUser,
        expectedPassword: adminPassword,
        pepper: hashPepper,
      });
      const gate = await rpc('zadmin_login_gate', {
        p_ip_hash: ipHash,
        p_device_hash: deviceHash,
        p_credentials_valid: validCredentials,
      });
      if (gate?.blocked === true) {
        const retryAfter = Math.max(1, Number(gate.retryAfterSeconds) || 1);
        return jsonResponse(origin, {
          error: 'Demasiados intentos. Inténtalo más tarde.',
          code: 'login_rate_limited',
          attemptsRemaining: 0,
          retryAfterSeconds: retryAfter,
        }, 429, { 'Retry-After': String(retryAfter) });
      }
      if (gate?.authenticated !== true) {
        return jsonResponse(origin, {
          error: 'Credenciales no válidas.',
          code: 'invalid_credentials',
          attemptsRemaining: Number(gate?.attemptsRemaining) || 0,
        }, 401);
      }

      const sessionToken = randomHex();
      const session = await rpc('zadmin_create_session', {
        p_token_hash: await pepperedDigest(sessionToken, hashPepper, 'zadmin-session'),
        p_ip_hash: ipHash,
        p_device_hash: deviceHash,
      });
      if (!session?.sessionId) throw new Error('Session creation failed');
      return jsonResponse(origin, {
        token: sessionToken,
        expiresAt: session.expiresAt,
      }, 201);
    }

    const session = await authenticatedSession(request, ipHash, deviceHash);
    if (!session) return jsonResponse(origin, { error: 'Admin session is invalid or expired.', code: 'invalid_session' }, 401);

    if (action === 'logout') {
      await rpc('zadmin_revoke_session', { p_session_id: session.sessionId });
      return jsonResponse(origin, { loggedOut: true });
    }
    if (action === 'overview') return jsonResponse(origin, await overview(body));
    if (action === 'detail') {
      const result = await detail(body);
      return result.error ? jsonResponse(origin, { error: 'Invalid investigation target.', code: result.error }, 400) : jsonResponse(origin, result);
    }
    if (action === 'bans') return jsonResponse(origin, { bans: await listBans() });
    if (action === 'audit') return jsonResponse(origin, { events: await auditLog() });
    if (action === 'ban') {
      const scope = normalizeAdminScope(body.scope);
      const target = scope ? validateDetailTarget(scope, body.target) : null;
      const duration = parseBanDurationMinutes(body.durationMinutes ?? body.duration);
      const reason = String(body.reason ?? '').trim();
      if (!scope || !target || !duration.valid || reason.length < 3 || reason.length > 500) {
        return jsonResponse(origin, { error: 'Invalid ban request.', code: 'invalid_ban' }, 400);
      }
      const result = await rpc('zadmin_create_manual_ban', {
        p_scope: scope,
        p_target: target,
        p_duration_minutes: duration.minutes,
        p_reason: reason,
        p_actor_session_id: session.sessionId,
      });
      if (result?.error) {
        const status = result.error === 'ban_already_active' ? 409 : result.error === 'target_not_found' ? 404 : 400;
        return jsonResponse(origin, { error: 'Could not apply the ban.', code: result.error, banId: result.banId }, status);
      }
      return jsonResponse(origin, result, 201);
    }
    if (action === 'revoke-ban') {
      const banId = String(body.banId ?? '').trim();
      const reason = String(body.reason ?? '').trim();
      if (!UUID.test(banId) || reason.length < 3 || reason.length > 500) {
        return jsonResponse(origin, { error: 'Invalid revoke request.', code: 'invalid_revoke' }, 400);
      }
      const result = await rpc('zadmin_revoke_manual_ban', {
        p_ban_id: banId,
        p_reason: reason,
        p_actor_session_id: session.sessionId,
      });
      if (result?.error) {
        const status = result.error === 'ban_not_found' ? 404 : result.error === 'ban_already_revoked' ? 409 : 400;
        return jsonResponse(origin, { error: 'Could not revoke the ban.', code: result.error }, status);
      }
      return jsonResponse(origin, result);
    }

    return jsonResponse(origin, { error: 'Unknown admin action.' }, 404);
  } catch (error) {
    logError('zadmin.request_failed', error);
    return jsonResponse(origin, { error: 'Admin operation failed.' }, 500);
  }
});
