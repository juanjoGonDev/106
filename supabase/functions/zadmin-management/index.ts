import { createClient } from 'npm:@supabase/supabase-js@2.95.0';
import {
  evaluateNicknameCandidate,
  isNicknameCandidateError,
} from '../_shared/nickname-management.ts';
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
const PAGE_SIZES = new Set([10, 25, 50]);

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

function pagination(body: JsonObject) {
  const page = Math.max(1, Math.min(100_000, Math.trunc(Number(body.page) || 1)));
  const requestedSize = Math.trunc(Number(body.pageSize) || 25);
  return { page, pageSize: PAGE_SIZES.has(requestedSize) ? requestedSize : 25 };
}

async function listRestrictions(body: JsonObject) {
  const { page, pageSize } = pagination(body);
  const requestedScope = ['account', 'nick', 'device', 'ip'].includes(String(body.scope)) ? String(body.scope) : 'all';
  const requestedStatus = ['active', 'lifted', 'revoked', 'expired'].includes(String(body.status)) ? String(body.status) : 'all';
  const result = await rpc('zadmin_management_list_restrictions', {
    p_page: page,
    p_page_size: pageSize,
    p_status: requestedStatus,
    p_scope: requestedScope,
    p_search: normalizedSearch(body.search),
  });
  const items = Array.isArray(result?.items) ? result.items : [];
  return { restrictions: items, items, pagination: result?.pagination ?? null };
}

async function listPlayers(body: JsonObject) {
  const { page, pageSize } = pagination(body);
  const result = await rpc('zadmin_management_list_players', {
    p_page: page,
    p_page_size: pageSize,
    p_search: normalizedSearch(body.search),
  });
  const items = Array.isArray(result?.items) ? result.items : [];
  return { players: items, items, pagination: result?.pagination ?? null };
}

async function nicknameAvailability(playerId: string, candidate: { key: string }) {
  const { data, error } = await supabase
    .from('game_players')
    .select('player_id')
    .eq('nick_key', candidate.key)
    .maybeSingle();
  if (error) throw new Error('Could not check nickname availability');
  if (!data) return 'available';
  return String(data.player_id) === playerId ? 'owned' : 'occupied';
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
    if (action === 'restrictions') return jsonResponse(origin, await listRestrictions(body));
    if (action === 'players') return jsonResponse(origin, await listPlayers(body));

    if (action === 'check-nickname') {
      const playerId = String(body.playerId ?? '').trim();
      const nickname = evaluateNicknameCandidate(body.nick);
      if (!UUID.test(playerId)) return jsonResponse(origin, { error: 'Invalid player.', code: 'invalid_player' }, 400);
      if (isNicknameCandidateError(nickname)) {
        return jsonResponse(origin, {
          availability: nickname.error.replace(/^nick_/, 'invalid-'),
          error: nickname.message,
          code: nickname.error,
        });
      }
      const availability = await nicknameAvailability(playerId, nickname);
      return jsonResponse(origin, { availability, nick: nickname.nick, key: nickname.key });
    }

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
        return jsonResponse(origin, { error: 'No se pudo actualizar la restricción automática.', code: result.error }, status);
      }
      return jsonResponse(origin, result);
    }

    if (action === 'rename-player') {
      const playerId = String(body.playerId ?? '').trim();
      const actionReason = reason(body.reason);
      const nickname = evaluateNicknameCandidate(body.nick);
      if (!UUID.test(playerId) || !actionReason || isNicknameCandidateError(nickname)) {
        return jsonResponse(origin, {
          error: isNicknameCandidateError(nickname) ? nickname.message : 'Invalid player rename request.',
          code: isNicknameCandidateError(nickname) ? nickname.error : 'invalid_player_rename',
        }, 400);
      }
      const availability = await nicknameAvailability(playerId, nickname);
      if (availability === 'occupied') return jsonResponse(origin, { error: 'Ese nick ya está ocupado.', code: 'nickname_taken' }, 409);
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
