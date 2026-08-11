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

if (!supabaseUrl || !serviceKey || !hashPepper) throw new Error('Missing required zadmin Edge Function environment variables.');

const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/i;
const PAGE_SIZES = new Set([10, 25, 50]);
const ATTEMPT_FACT_COLUMNS = 'id,nick,nick_key,account_id,device_hash,ip_hash,difference_ms,verified,verification_reasons,created_at,integrity_status,risk_score,risk_reasons,integrity_evidence,integrity_policy_version,integrity_evaluated_at,manual_invalidated,manual_action,manual_action_reason,manual_action_at';

type Row = Record<string, unknown>;

function corsHeaders(origin: string | null) {
  return {
    'Access-Control-Allow-Origin': origin && allowedOrigins.has(origin) ? origin : [...allowedOrigins][0],
    'Access-Control-Allow-Headers': 'authorization, content-type, x-device-id',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

function jsonResponse(origin: string | null, body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
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
    source: 'server', level: 'error', event,
    message: error instanceof Error ? error.message.slice(0, 240) : 'Unknown zadmin error',
  }));
}

async function rpc(name: string, parameters: Row = {}) {
  const { data, error } = await supabase.rpc(name, parameters);
  if (error) {
    logError(`zadmin.rpc.${name}`, error);
    throw new Error('Database operation failed');
  }
  return data as Row;
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

function pageRequest(body: Row, prefix = '') {
  const pageValue = body[`${prefix}Page`] ?? body.page;
  const sizeValue = body[`${prefix}PageSize`] ?? body.pageSize;
  const page = Math.max(1, Math.min(100_000, Math.trunc(Number(pageValue) || 1)));
  const requested = Math.trunc(Number(sizeValue) || 25);
  return { page, pageSize: PAGE_SIZES.has(requested) ? requested : 25 };
}

function pageMeta(page: number, pageSize: number, total: number) {
  const totalPages = total > 0 ? Math.ceil(total / pageSize) : 0;
  const normalizedPage = totalPages > 0 ? Math.min(page, totalPages) : 1;
  return {
    page: normalizedPage,
    pageSize,
    total,
    totalPages,
    hasPrevious: normalizedPage > 1,
    hasNext: totalPages > 0 && normalizedPage < totalPages,
  };
}

function validateDetailTarget(scope: string, value: unknown) {
  const target = String(value ?? '').trim();
  if (scope === 'account') return UUID.test(target) ? target : null;
  if (scope === 'ip') return HASH.test(target) ? target.toLowerCase() : null;
  return target && target.length <= 80 ? target.toLocaleLowerCase('es') : null;
}

function banTarget(ban: Row) {
  if (ban.scope === 'account') return String(ban.account_id ?? '');
  if (ban.scope === 'nick') return String(ban.nick_key ?? '');
  return String(ban.ip_hash ?? '');
}

function integrityTarget(ban: Row) {
  if (ban.scope === 'account') return String(ban.account_id ?? '');
  if (ban.scope === 'device') return String(ban.device_hash ?? '');
  return String(ban.ip_hash ?? '');
}

function activeBan(ban: Row, now = Date.now()) {
  if (ban.revoked_at) return false;
  if (!ban.expires_at) return true;
  const expires = Date.parse(String(ban.expires_at));
  return Number.isFinite(expires) && expires > now;
}

function manualRestriction(ban: Row, now = Date.now()) {
  const active = activeBan(ban, now);
  const expired = !ban.revoked_at && Boolean(ban.expires_at) && !active;
  return {
    ...ban,
    source: 'manual',
    restriction_kind: 'manual',
    read_only: false,
    target: banTarget(ban),
    active,
    status: ban.revoked_at ? 'revoked' : expired ? 'expired' : 'active',
    triggered_at: ban.created_at,
  };
}

function automaticRestriction(ban: Row, latestAction: Row | null = null, now = Date.now()) {
  const expires = Date.parse(String(ban.expires_at ?? ''));
  const expired = !Number.isFinite(expires) || expires <= now;
  const lifted = !expired && latestAction?.action === 'lift';
  const status = expired ? 'expired' : lifted ? 'lifted' : 'active';
  return {
    ...ban,
    source: 'integrity',
    restriction_kind: 'integrity',
    read_only: false,
    target: integrityTarget(ban),
    active: status === 'active',
    status,
    adminAction: latestAction,
    created_at: ban.triggered_at,
    revoked_at: null,
    revoked_reason: null,
  };
}

async function fetchAttemptFacts(rangeDays: number) {
  const since = new Date(Date.now() - rangeDays * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from('game_admin_attempt_facts')
    .select(ATTEMPT_FACT_COLUMNS)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(2_000);
  if (error) throw new Error('Could not load integrity facts');
  return Array.isArray(data) ? data as Row[] : [];
}

async function fetchManualBans() {
  const { data, error } = await supabase.from('game_admin_bans')
    .select('id,scope,account_id,nick_key,ip_hash,reason,created_at,expires_at,revoked_at,revoked_reason')
    .order('created_at', { ascending: false }).limit(500);
  if (error) throw new Error('Could not load bans');
  return Array.isArray(data) ? data as Row[] : [];
}

async function fetchAutomaticBans() {
  const [{ data: bans, error: banError }, { data: actions, error: actionError }] = await Promise.all([
    supabase.from('game_integrity_bans')
      .select('id,scope,account_id,device_hash,ip_hash,reason,source_attempt_id,triggered_at,expires_at,policy_version,evidence')
      .order('triggered_at', { ascending: false }).limit(500),
    supabase.from('game_integrity_ban_admin_actions')
      .select('id,ban_id,action,reason,created_at').order('created_at', { ascending: false }).limit(1_500),
  ]);
  if (banError || actionError) throw new Error('Could not load automatic restrictions');
  const latest = new Map<string, Row>();
  for (const action of Array.isArray(actions) ? actions : []) {
    const key = String(action.ban_id ?? '');
    if (!latest.has(key)) latest.set(key, action as Row);
  }
  return (Array.isArray(bans) ? bans : []).map((ban) => automaticRestriction(ban as Row, latest.get(String(ban.id)) ?? null));
}

async function overview(body: Row) {
  const scope = normalizeAdminScope(body.scope) ?? 'account';
  const rangeDays = normalizeAdminRangeDays(body.rangeDays);
  const search = normalizeAdminSearch(body.search);
  const { page, pageSize } = pageRequest(body, 'entities');
  const [facts, bans, automatic] = await Promise.all([fetchAttemptFacts(rangeDays), fetchManualBans(), fetchAutomaticBans()]);
  const allEntities = aggregateIntegrityEntities(facts, scope, search);
  const pagination = pageMeta(page, pageSize, allEntities.length);
  const start = (pagination.page - 1) * pageSize;
  const entities = allEntities.slice(start, start + pageSize);
  const now = Date.now();
  return {
    scope,
    rangeDays,
    truncated: facts.length >= 2_000,
    pagination,
    summary: {
      attempts: facts.length,
      verifiedAttempts: facts.filter((row) => row.verified === true).length,
      watchAttempts: facts.filter((row) => row.integrity_status === 'watch').length,
      excludedAttempts: facts.filter((row) => row.integrity_status === 'excluded').length,
      distinctAccounts: new Set(facts.map((row) => row.account_id).filter(Boolean)).size,
      distinctNicks: new Set(facts.map((row) => row.nick_key).filter(Boolean)).size,
      distinctIps: new Set(facts.map((row) => row.ip_hash).filter(Boolean)).size,
      activeManualBans: bans.filter((ban) => activeBan(ban, now)).length,
      activeAutomaticRestrictions: automatic.filter((ban) => ban.active === true).length,
    },
    entities,
  };
}

function applyTarget(query: any, scope: string, target: string) {
  if (scope === 'account') return query.eq('account_id', target);
  if (scope === 'ip') return query.eq('ip_hash', target);
  return query.eq('nick_key', target);
}

function relatedAutomaticRestrictions(facts: Row[], automatic: Row[], scope: string, target: string) {
  const accounts = new Set(facts.map((row) => String(row.account_id ?? '')).filter(Boolean));
  const devices = new Set(facts.map((row) => String(row.device_hash ?? '')).filter(Boolean));
  const ips = new Set(facts.map((row) => String(row.ip_hash ?? '')).filter(Boolean));
  if (scope === 'account') accounts.add(target);
  if (scope === 'ip') ips.add(target);
  return automatic.filter((ban) => (
    (ban.scope === 'account' && accounts.has(String(ban.account_id ?? '')))
    || (ban.scope === 'device' && devices.has(String(ban.device_hash ?? '')))
    || (ban.scope === 'ip' && ips.has(String(ban.ip_hash ?? '')))
  ));
}

async function detail(body: Row) {
  const scope = normalizeAdminScope(body.scope);
  if (!scope) return { error: 'invalid_scope' };
  const target = validateDetailTarget(scope, body.target);
  if (!target) return { error: 'invalid_target' };
  const { page, pageSize } = pageRequest(body, 'attempts');

  let analyticsQuery = supabase.from('game_admin_attempt_facts').select(ATTEMPT_FACT_COLUMNS).order('created_at', { ascending: false }).limit(500);
  analyticsQuery = applyTarget(analyticsQuery, scope, target);
  let attemptQuery = supabase.from('game_admin_attempt_facts').select(ATTEMPT_FACT_COLUMNS, { count: 'exact' }).order('created_at', { ascending: false });
  attemptQuery = applyTarget(attemptQuery, scope, target);
  const rangeStart = (page - 1) * pageSize;
  attemptQuery = attemptQuery.range(rangeStart, rangeStart + pageSize - 1);

  const [{ data: analyticsRows, error: analyticsError }, attemptResult, bans, automatic] = await Promise.all([
    analyticsQuery,
    attemptQuery,
    fetchManualBans(),
    fetchAutomaticBans(),
  ]);
  if (analyticsError || attemptResult.error) throw new Error('Could not load entity detail');
  const facts = Array.isArray(analyticsRows) ? analyticsRows as Row[] : [];
  const attempts = Array.isArray(attemptResult.data) ? attemptResult.data as Row[] : [];
  const attemptPagination = pageMeta(page, pageSize, Number(attemptResult.count) || 0);
  const now = Date.now();
  const matchingBans = bans.filter((ban) => String(ban.scope) === scope && banTarget(ban) === target).map((ban) => manualRestriction(ban, now));
  const matchingAutomatic = relatedAutomaticRestrictions(facts, automatic, scope, target);

  return {
    scope,
    target,
    summary: {
      attempts: Number(attemptResult.count) || facts.length,
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
    attempts,
    attemptPagination,
    bans: matchingBans,
    automaticRestrictions: matchingAutomatic,
  };
}

async function restrictions(body: Row) {
  const { page, pageSize } = pageRequest(body, 'bans');
  const result = await rpc('zadmin_management_list_restrictions', {
    p_page: page,
    p_page_size: pageSize,
    p_status: 'all',
    p_scope: 'all',
    p_search: '',
  });
  return {
    bans: Array.isArray(result.items) ? result.items : [],
    pagination: result.pagination ?? pageMeta(page, pageSize, 0),
  };
}

async function auditLog(body: Row) {
  const { page, pageSize } = pageRequest(body, 'audit');
  const start = (page - 1) * pageSize;
  const { data, error, count } = await supabase.from('game_admin_audit_events')
    .select('id,action,target_scope,target_key,metadata,created_at', { count: 'exact' })
    .order('created_at', { ascending: false }).order('id', { ascending: false })
    .range(start, start + pageSize - 1);
  if (error) throw new Error('Could not load audit log');
  return { events: Array.isArray(data) ? data : [], pagination: pageMeta(page, pageSize, Number(count) || 0) };
}

function actionReason(value: unknown) {
  const valueText = String(value ?? '').trim();
  return valueText.length >= 3 && valueText.length <= 500 ? valueText : '';
}

Deno.serve(async (request) => {
  const origin = request.headers.get('origin');
  if (request.method === 'OPTIONS') {
    if (origin && !allowedOrigins.has(origin)) return new Response(null, { status: 403 });
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (request.method !== 'POST') return jsonResponse(origin, { error: 'Method not allowed.' }, 405);
  if (origin && !allowedOrigins.has(origin)) return jsonResponse(origin, { error: 'Origin not allowed.' }, 403);
  if (Number(request.headers.get('content-length') ?? 0) > ZADMIN_MAX_BODY_BYTES) return jsonResponse(origin, { error: 'Request too large.' }, 413);

  try {
    const source = await request.text();
    if (new TextEncoder().encode(source).byteLength > ZADMIN_MAX_BODY_BYTES) return jsonResponse(origin, { error: 'Request too large.' }, 413);
    let body: Row;
    try {
      const parsed = JSON.parse(source || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid body');
      body = parsed as Row;
    } catch {
      return jsonResponse(origin, { error: 'Invalid JSON body.' }, 400);
    }

    const action = String(body.action ?? '');
    const deviceId = normalizeAdminDeviceId(request.headers.get('x-device-id'));
    if (!deviceId) return jsonResponse(origin, { error: 'Invalid device identifier.' }, 400);
    const { ipHash, deviceHash } = await subjectHashes(request, deviceId);

    if (action === 'login') {
      if (!adminUser || !adminPassword) return jsonResponse(origin, { error: 'Admin authentication is not configured.' }, 503);
      const validCredentials = await adminCredentialsMatch({
        username: body.username, password: body.password,
        expectedUsername: adminUser, expectedPassword: adminPassword, pepper: hashPepper,
      });
      const gate = await rpc('zadmin_login_gate', { p_ip_hash: ipHash, p_device_hash: deviceHash, p_credentials_valid: validCredentials });
      if (gate?.blocked === true) {
        const retryAfter = Math.max(1, Number(gate.retryAfterSeconds) || 1);
        return jsonResponse(origin, { error: 'Demasiados intentos. Inténtalo más tarde.', code: 'login_rate_limited', attemptsRemaining: 0, retryAfterSeconds: retryAfter }, 429, { 'Retry-After': String(retryAfter) });
      }
      if (gate?.authenticated !== true) return jsonResponse(origin, { error: 'Credenciales no válidas.', code: 'invalid_credentials', attemptsRemaining: Number(gate?.attemptsRemaining) || 0 }, 401);
      const sessionToken = randomHex();
      const session = await rpc('zadmin_create_session', {
        p_token_hash: await pepperedDigest(sessionToken, hashPepper, 'zadmin-session'),
        p_ip_hash: ipHash, p_device_hash: deviceHash,
      });
      if (!session?.sessionId) throw new Error('Session creation failed');
      return jsonResponse(origin, { token: sessionToken, expiresAt: session.expiresAt }, 201);
    }

    const session = await authenticatedSession(request, ipHash, deviceHash);
    if (!session) return jsonResponse(origin, { error: 'Admin session is invalid or expired.', code: 'invalid_session' }, 401);

    if (action === 'logout') {
      await rpc('zadmin_revoke_session', { p_session_id: session.sessionId });
      return jsonResponse(origin, { loggedOut: true });
    }
    if (action === 'session-status') return jsonResponse(origin, { valid: true, expiresAt: session.expiresAt });
    if (action === 'overview') return jsonResponse(origin, await overview(body));
    if (action === 'detail') {
      const result = await detail(body);
      return result.error ? jsonResponse(origin, { error: 'Invalid investigation target.', code: result.error }, 400) : jsonResponse(origin, result);
    }
    if (action === 'bans') return jsonResponse(origin, await restrictions(body));
    if (action === 'audit') return jsonResponse(origin, await auditLog(body));

    if (action === 'ban') {
      const scope = normalizeAdminScope(body.scope);
      const target = scope ? validateDetailTarget(scope, body.target) : null;
      const duration = parseBanDurationMinutes(body.durationMinutes ?? body.duration);
      const reason = actionReason(body.reason);
      if (!scope || !target || !duration.valid || !reason) return jsonResponse(origin, { error: 'Invalid ban request.', code: 'invalid_ban' }, 400);
      const result = await rpc('zadmin_create_manual_ban', {
        p_scope: scope, p_target: target, p_duration_minutes: duration.minutes,
        p_reason: reason, p_actor_session_id: session.sessionId,
      });
      if (result?.error) {
        const status = result.error === 'ban_already_active' ? 409 : result.error === 'target_not_found' ? 404 : 400;
        return jsonResponse(origin, { error: 'Could not apply the ban.', code: result.error, banId: result.banId }, status);
      }
      return jsonResponse(origin, result, 201);
    }

    if (action === 'revoke-ban') {
      const banId = String(body.banId ?? '').trim();
      const reason = actionReason(body.reason);
      if (!UUID.test(banId) || !reason) return jsonResponse(origin, { error: 'Invalid revoke request.', code: 'invalid_revoke' }, 400);
      const result = await rpc('zadmin_revoke_manual_ban', { p_ban_id: banId, p_reason: reason, p_actor_session_id: session.sessionId });
      if (result?.error) {
        const status = result.error === 'ban_not_found' ? 404 : result.error === 'ban_already_revoked' ? 409 : 400;
        return jsonResponse(origin, { error: 'Could not revoke the ban.', code: result.error }, status);
      }
      return jsonResponse(origin, result);
    }

    if (action === 'lift-integrity-restriction' || action === 'reinstate-integrity-restriction') {
      const banId = Number(body.banId);
      const reason = actionReason(body.reason);
      if (!Number.isSafeInteger(banId) || banId <= 0 || !reason) return jsonResponse(origin, { error: 'Invalid automatic restriction action.', code: 'invalid_restriction_action' }, 400);
      const result = await rpc('zadmin_set_integrity_ban_action', {
        p_ban_id: banId,
        p_action: action === 'lift-integrity-restriction' ? 'lift' : 'reinstate',
        p_reason: reason,
        p_actor_session_id: session.sessionId,
      });
      if (result?.error) {
        const status = result.error === 'ban_not_found' ? 404 : ['already_lifted', 'not_lifted', 'ban_expired'].includes(String(result.error)) ? 409 : 400;
        return jsonResponse(origin, { error: 'No se pudo actualizar la restricción automática.', code: result.error }, status);
      }
      return jsonResponse(origin, result);
    }

    if (action === 'invalidate-attempt' || action === 'restore-attempt') {
      const attemptId = String(body.attemptId ?? '').trim();
      const reason = actionReason(body.reason);
      if (!UUID.test(attemptId) || !reason) return jsonResponse(origin, { error: 'Invalid attempt review request.', code: 'invalid_attempt_review' }, 400);
      const result = await rpc('zadmin_set_attempt_review', {
        p_attempt_id: attemptId, p_invalidated: action === 'invalidate-attempt', p_reason: reason, p_actor_session_id: session.sessionId,
      });
      if (result?.error) {
        const status = result.error === 'attempt_not_found' ? 404 : ['attempt_already_invalidated', 'attempt_not_invalidated'].includes(String(result.error)) ? 409 : 400;
        return jsonResponse(origin, { error: 'Could not update the attempt review.', code: result.error }, status);
      }
      return jsonResponse(origin, result);
    }

    return jsonResponse(origin, { error: 'Unknown admin action.' }, 404);
  } catch (error) {
    logError('zadmin.request_failed', error);
    return jsonResponse(origin, { error: 'Admin operation failed.' }, 500);
  }
});
