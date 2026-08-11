import { createClient } from 'npm:@supabase/supabase-js@2.95.0';
import { normalizeNickname } from '../_shared/nickname-policy.js';
import { moderateNickname } from '../game-api/moderation.ts';
import {
  bearerTokenFromHeader,
  normalizeAdminDeviceId,
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
const allowedOrigins = new Set(
  (Deno.env.get('ALLOWED_ORIGINS') ?? 'http://localhost:3000,http://127.0.0.1:3000,https://juanjogondev.github.io')
    .split(',').map((item) => item.trim()).filter(Boolean),
);

if (!supabaseUrl || !serviceKey || !hashPepper) throw new Error('Missing required zadmin management environment variables.');

const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 16_384;

type JsonObject = Record<string, unknown>;
type AdminSession = { sessionId: string; expiresAt?: string };

function corsHeaders(origin: string | null) {
  return {
    'Access-Control-Allow-Origin': origin && allowedOrigins.has(origin) ? origin : [...allowedOrigins][0],
    'Access-Control-Allow-Headers': 'authorization, content-type, x-device-id',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

function jsonResponse(origin: string | null, body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      ...corsHeaders(origin),
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function clientIp(request: Request) {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('cf-connecting-ip')
    || request.headers.get('x-real-ip')
    || 'unknown';
}

function logError(event: string, error: unknown) {
  console.error(JSON.stringify({
    source: 'server',
    level: 'error',
    event,
    message: error instanceof Error ? error.message.slice(0, 240) : 'Unknown zadmin management error',
  }));
}

async function rpc(name: string, parameters: JsonObject = {}) {
  const { data, error } = await supabase.rpc(name, parameters);
  if (error) {
    logError(`zadmin-management.rpc.${name}`, error);
    throw new Error('Database operation failed');
  }
  return data as JsonObject;
}

async function authenticatedSession(request: Request, deviceId: string): Promise<AdminSession | null> {
  const token = bearerTokenFromHeader(request.headers.get('authorization'));
  if (!token) return null;
  const [tokenHash, ipHash, deviceHash] = await Promise.all([
    pepperedDigest(token, hashPepper, 'zadmin-session'),
    pepperedDigest(clientIp(request), hashPepper, 'zadmin-ip'),
    pepperedDigest(deviceId, hashPepper, 'zadmin-device'),
  ]);
  const session = await rpc('zadmin_validate_session', {
    p_token_hash: tokenHash,
    p_ip_hash: ipHash,
    p_device_hash: deviceHash,
  });
  if (session?.valid !== true || !UUID.test(String(session.sessionId ?? ''))) return null;
  return { sessionId: String(session.sessionId), expiresAt: session.expiresAt ? String(session.expiresAt) : undefined };
}

function normalizedSearch(value: unknown) {
  return String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase('es').slice(0, 100);
}

function integrityTarget(row: JsonObject) {
  if (row.scope === 'account') return String(row.account_id ?? '');
  if (row.scope === 'device') return String(row.device_hash ?? '');
  return String(row.ip_hash ?? '');
}

function manualTarget(row: JsonObject) {
  if (row.scope === 'account') return String(row.account_id ?? '');
  if (row.scope === 'nick') return String(row.nick_key ?? '');
  return String(row.ip_hash ?? '');
}

function addLabel(map: Map<string, Set<string>>, key: string, label: string) {
  if (!key || !label) return;
  let values = map.get(key);
  if (!values) {
    values = new Set<string>();
    map.set(key, values);
  }
  values.add(label);
}

async function listRestrictions(body: JsonObject) {
  const search = normalizedSearch(body.search);
  const requestedScope = ['account', 'nick', 'device', 'ip'].includes(String(body.scope)) ? String(body.scope) : 'all';
  const requestedStatus = ['active', 'lifted', 'revoked', 'expired'].includes(String(body.status)) ? String(body.status) : 'all';
  const [integrityResult, actionsResult, manualResult, factsResult] = await Promise.all([
    supabase.from('game_integrity_bans')
      .select('id,scope,account_id,device_hash,ip_hash,reason,source_attempt_id,triggered_at,expires_at,policy_version,evidence')
      .order('triggered_at', { ascending: false }).limit(500),
    supabase.from('game_integrity_ban_admin_actions')
      .select('id,ban_id,action,reason,created_at')
      .order('created_at', { ascending: false }).limit(1_500),
    supabase.from('game_admin_bans')
      .select('id,scope,account_id,nick_key,ip_hash,reason,created_at,expires_at,revoked_at,revoked_reason')
      .order('created_at', { ascending: false }).limit(500),
    supabase.from('game_admin_attempt_facts')
      .select('nick,nick_key,account_id,device_hash,ip_hash,created_at')
      .order('created_at', { ascending: false }).limit(2_000),
  ]);
  if (integrityResult.error || actionsResult.error || manualResult.error || factsResult.error) {
    throw new Error('Could not load restriction management data');
  }

  const latestAction = new Map<string, JsonObject>();
  for (const action of Array.isArray(actionsResult.data) ? actionsResult.data : []) {
    const key = String(action.ban_id ?? '');
    if (!latestAction.has(key)) latestAction.set(key, action as JsonObject);
  }

  const factsByAccount = new Map<string, Set<string>>();
  const factsByDevice = new Map<string, Set<string>>();
  const factsByIp = new Map<string, Set<string>>();
  for (const fact of Array.isArray(factsResult.data) ? factsResult.data : []) {
    const label = String(fact.nick ?? fact.nick_key ?? '').trim();
    addLabel(factsByAccount, String(fact.account_id ?? ''), label);
    addLabel(factsByDevice, String(fact.device_hash ?? ''), label);
    addLabel(factsByIp, String(fact.ip_hash ?? ''), label);
  }

  const now = Date.now();
  const automatic = (Array.isArray(integrityResult.data) ? integrityResult.data : []).map((ban) => {
    const id = String(ban.id ?? '');
    const target = integrityTarget(ban as JsonObject);
    const adminAction = latestAction.get(id) ?? null;
    const expiresAt = Date.parse(String(ban.expires_at ?? ''));
    const expired = !Number.isFinite(expiresAt) || expiresAt <= now;
    const lifted = !expired && adminAction?.action === 'lift';
    const status = expired ? 'expired' : lifted ? 'lifted' : 'active';
    const relatedNicks = ban.scope === 'account'
      ? [...(factsByAccount.get(target) ?? [])]
      : ban.scope === 'device'
        ? [...(factsByDevice.get(target) ?? [])]
        : [...(factsByIp.get(target) ?? [])];
    return {
      ...ban,
      source: 'integrity',
      target,
      status,
      active: status === 'active',
      adminAction,
      relatedNicks: relatedNicks.slice(0, 12),
    };
  });

  const manual = (Array.isArray(manualResult.data) ? manualResult.data : []).map((ban) => {
    const target = manualTarget(ban as JsonObject);
    const expiresAt = ban.expires_at ? Date.parse(String(ban.expires_at)) : Number.POSITIVE_INFINITY;
    const revoked = Boolean(ban.revoked_at);
    const expired = !revoked && Number.isFinite(expiresAt) && expiresAt <= now;
    const status = revoked ? 'revoked' : expired ? 'expired' : 'active';
    const relatedNicks = ban.scope === 'nick'
      ? [String(ban.nick_key ?? '')].filter(Boolean)
      : ban.scope === 'account'
        ? [...(factsByAccount.get(target) ?? [])]
        : [...(factsByIp.get(target) ?? [])];
    return {
      ...ban,
      source: 'manual',
      target,
      status,
      active: status === 'active',
      relatedNicks: relatedNicks.slice(0, 12),
      triggered_at: ban.created_at,
      source_attempt_id: null,
      policy_version: null,
      evidence: null,
      adminAction: revoked ? { action: 'revoke', reason: ban.revoked_reason, created_at: ban.revoked_at } : null,
    };
  });

  return [...automatic, ...manual]
    .filter((ban) => {
      if (requestedScope !== 'all' && ban.scope !== requestedScope) return false;
      if (requestedStatus !== 'all' && ban.status !== requestedStatus) return false;
      if (!search) return true;
      return [ban.target, ban.scope, ban.reason, ban.source, ...ban.relatedNicks]
        .some((value) => String(value ?? '').toLocaleLowerCase('es').includes(search));
    })
    .sort((left, right) => Date.parse(String(right.triggered_at ?? '')) - Date.parse(String(left.triggered_at ?? '')))
    .slice(0, 250);
}

async function listPlayers(body: JsonObject) {
  const search = normalizedSearch(body.search);
  const [playersResult, linksResult, requirementsResult, accountsResult] = await Promise.all([
    supabase.from('game_players').select('player_id,nick,nick_key,created_at').order('created_at', { ascending: false }).limit(750),
    supabase.from('game_account_players').select('player_id,account_id,linked_at').limit(1_000),
    supabase.from('game_player_name_requirements').select('player_id,required,reason,requested_at,resolved_at,updated_at').limit(1_000),
    supabase.from('game_accounts').select('id,contact_email_verified_at,merged_into_account_id').limit(1_000),
  ]);
  if (playersResult.error || linksResult.error || requirementsResult.error || accountsResult.error) {
    throw new Error('Could not load player management data');
  }

  const linkByPlayer = new Map((Array.isArray(linksResult.data) ? linksResult.data : []).map((row) => [String(row.player_id), row as JsonObject]));
  const requirementByPlayer = new Map((Array.isArray(requirementsResult.data) ? requirementsResult.data : []).map((row) => [String(row.player_id), row as JsonObject]));
  const accountById = new Map((Array.isArray(accountsResult.data) ? accountsResult.data : []).map((row) => [String(row.id), row as JsonObject]));

  return (Array.isArray(playersResult.data) ? playersResult.data : []).map((player) => {
    const playerId = String(player.player_id ?? '');
    const link = linkByPlayer.get(playerId) ?? null;
    const accountId = String(link?.account_id ?? '');
    const account = accountById.get(accountId) ?? null;
    const requirement = requirementByPlayer.get(playerId) ?? null;
    return {
      playerId,
      nick: player.nick,
      nickKey: player.nick_key,
      accountId: accountId || null,
      linkedAt: link?.linked_at ?? null,
      renameRequired: requirement?.required === true,
      renameRequirement: requirement?.required === true ? requirement : null,
      verifiedEmailAvailable: Boolean(account?.contact_email_verified_at),
    };
  }).filter((player) => {
    if (!search) return true;
    return [player.playerId, player.nick, player.nickKey, player.accountId]
      .some((value) => String(value ?? '').toLocaleLowerCase('es').includes(search));
  }).slice(0, 250);
}

function moderatedNickname(value: unknown) {
  const moderation = moderateNickname(String(value ?? ''));
  if (!moderation.allowed) return { error: `nick_${String(moderation.reason ?? 'invalid')}` } as const;
  const nick = normalizeNickname(moderation.normalized);
  const key = nick.toLocaleLowerCase('es');
  if (nick.length < 2 || nick.length > 24 || key.length < 2 || key.length > 24) return { error: 'nick_invalid' } as const;
  return { nick, key } as const;
}

function reason(value: unknown) {
  const normalized = String(value ?? '').trim();
  return normalized.length >= 3 && normalized.length <= 500 ? normalized : '';
}

Deno.serve(async (request) => {
  const origin = request.headers.get('origin');
  if (request.method === 'OPTIONS') {
    if (origin && !allowedOrigins.has(origin)) return new Response(null, { status: 403 });
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (request.method !== 'POST') return jsonResponse(origin, { error: 'Method not allowed.' }, 405);
  if (origin && !allowedOrigins.has(origin)) return jsonResponse(origin, { error: 'Origin not allowed.' }, 403);
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return jsonResponse(origin, { error: 'Request too large.' }, 413);

  try {
    const source = await request.text();
    if (new TextEncoder().encode(source).byteLength > MAX_BODY_BYTES) return jsonResponse(origin, { error: 'Request too large.' }, 413);
    const parsed = JSON.parse(source || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return jsonResponse(origin, { error: 'Invalid JSON body.' }, 400);
    const body = parsed as JsonObject;
    const deviceId = normalizeAdminDeviceId(request.headers.get('x-device-id'));
    if (!deviceId) return jsonResponse(origin, { error: 'Invalid device identifier.' }, 400);
    const session = await authenticatedSession(request, deviceId);
    if (!session) return jsonResponse(origin, { error: 'Admin session is invalid or expired.', code: 'invalid_session' }, 401);

    const action = String(body.action ?? '');
    if (action === 'session-status') return jsonResponse(origin, { valid: true, expiresAt: session.expiresAt });
    if (action === 'restrictions') return jsonResponse(origin, { restrictions: await listRestrictions(body) });
    if (action === 'players') return jsonResponse(origin, { players: await listPlayers(body) });

    if (action === 'revoke-manual-restriction') {
      const banId = String(body.banId ?? '').trim();
      const actionReason = reason(body.reason);
      if (!UUID.test(banId) || !actionReason) {
        return jsonResponse(origin, { error: 'Invalid manual restriction action.', code: 'invalid_restriction_action' }, 400);
      }
      const result = await rpc('zadmin_revoke_manual_ban', {
        p_ban_id: banId,
        p_reason: actionReason,
        p_actor_session_id: session.sessionId,
      });
      if (result?.error) {
        const status = result.error === 'ban_not_found' ? 404 : result.error === 'ban_already_revoked' ? 409 : 400;
        return jsonResponse(origin, { error: 'Could not revoke the manual restriction.', code: result.error }, status);
      }
      return jsonResponse(origin, result);
    }

    if (action === 'lift-integrity-restriction' || action === 'reinstate-integrity-restriction') {
      const banId = Number(body.banId);
      const actionReason = reason(body.reason);
      if (!Number.isSafeInteger(banId) || banId <= 0 || !actionReason) {
        return jsonResponse(origin, { error: 'Invalid automatic restriction action.', code: 'invalid_restriction_action' }, 400);
      }
      const result = await rpc('zadmin_set_integrity_ban_action', {
        p_ban_id: banId,
        p_action: action === 'lift-integrity-restriction' ? 'lift' : 'reinstate',
        p_reason: actionReason,
        p_actor_session_id: session.sessionId,
      });
      if (result?.error) {
        const status = result.error === 'ban_not_found' ? 404
          : ['already_lifted', 'not_lifted', 'ban_expired'].includes(String(result.error)) ? 409 : 400;
        return jsonResponse(origin, { error: 'Could not update the automatic restriction.', code: result.error }, status);
      }
      return jsonResponse(origin, result);
    }

    if (action === 'rename-player') {
      const playerId = String(body.playerId ?? '').trim();
      const actionReason = reason(body.reason);
      const nickname = moderatedNickname(body.nick);
      if (!UUID.test(playerId) || !actionReason || 'error' in nickname) {
        return jsonResponse(origin, {
          error: 'Invalid player rename request.',
          code: 'error' in nickname ? nickname.error : 'invalid_player_rename',
        }, 400);
      }
      const result = await rpc('zadmin_rename_player', {
        p_player_id: playerId,
        p_new_nick: nickname.nick,
        p_new_nick_key: nickname.key,
        p_reason: actionReason,
        p_actor_session_id: session.sessionId,
      });
      if (result?.error) {
        const status = result.error === 'player_not_found' ? 404 : result.error === 'nickname_taken' ? 409 : 400;
        return jsonResponse(origin, { error: 'Could not rename the player.', code: result.error }, status);
      }
      return jsonResponse(origin, result);
    }

    if (action === 'require-player-rename') {
      const playerId = String(body.playerId ?? '').trim();
      const actionReason = reason(body.reason);
      if (!UUID.test(playerId) || !actionReason) {
        return jsonResponse(origin, { error: 'Invalid forced rename request.', code: 'invalid_force_rename' }, 400);
      }
      const result = await rpc('zadmin_require_player_rename', {
        p_player_id: playerId,
        p_reason: actionReason,
        p_actor_session_id: session.sessionId,
      });
      if (result?.error) {
        const status = result.error === 'player_not_found' ? 404 : result.error === 'player_unlinked' ? 409 : 400;
        const message = result.error === 'player_unlinked'
          ? 'El jugador no tiene una cuenta vinculada capaz de completar un cambio obligatorio. Usa Renombrar ahora.'
          : 'Could not require a nickname change.';
        return jsonResponse(origin, { error: message, code: result.error }, status);
      }
      return jsonResponse(origin, result);
    }

    return jsonResponse(origin, { error: 'Unknown admin action.' }, 404);
  } catch (error) {
    logError('zadmin-management.request_failed', error);
    return jsonResponse(origin, { error: 'Admin management operation failed.' }, 500);
  }
});