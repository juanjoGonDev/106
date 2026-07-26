import { createClient } from 'npm:@supabase/supabase-js@2.95.0';
import { moderateNickname } from '../game-api/moderation.ts';

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
const hashPepper = Deno.env.get('HASH_PEPPER');
const allowedOrigins = new Set(
  (Deno.env.get('ALLOWED_ORIGINS') ?? 'http://localhost:3000,http://127.0.0.1:3000,https://juanjogondev.github.io')
    .split(',').map((item) => item.trim()).filter(Boolean),
);

if (!supabaseUrl || !serviceKey || !hashPepper) {
  throw new Error('Missing required Edge Function environment variables.');
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const PRIVATE_TOKEN = /^[a-f0-9]{64}$/i;
const DEVICE_ID = /^[a-zA-Z0-9._:-]{16,80}$/;
const LEAGUE_ID = /^[A-Z0-9]{6}$/;
const ACTIONS = new Set([
  'create-league',
  'join-league',
  'league',
  'league-status',
  'list-leagues',
  'player-leagues',
]);

type JsonObject = Record<string, unknown>;
type AccountPlayer = { nick?: unknown; nickKey?: unknown };

function corsHeaders(origin: string | null) {
  return {
    'Access-Control-Allow-Origin': origin && allowedOrigins.has(origin) ? origin : [...allowedOrigins][0],
    'Access-Control-Allow-Headers': 'content-type, x-device-id, x-account-token, x-player-token',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
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
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function normalizeNick(value: unknown) {
  return String(value ?? '').normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, '').trim().replace(/\s+/g, ' ').slice(0, 24);
}

function nickKey(value: unknown) {
  return normalizeNick(value).toLocaleLowerCase('es');
}

function normalizeLeagueId(value: unknown) {
  const code = String(value ?? '').trim().toUpperCase();
  return LEAGUE_ID.test(code) ? code : null;
}

function normalizeVisibility(value: unknown, allowAll = false) {
  const visibility = String(value ?? '').trim().toLowerCase();
  const allowed = allowAll ? ['all', 'public', 'private'] : ['public', 'private'];
  return allowed.includes(visibility) ? visibility : null;
}

function normalizeInteger(value: unknown, minimum: number, maximum: number) {
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum && number <= maximum ? number : null;
}

function clientIp(request: Request) {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('cf-connecting-ip')
    || request.headers.get('x-real-ip')
    || 'unknown';
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${hashPepper}:${value}`));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function rpc(name: string, parameters: JsonObject = {}) {
  const { data, error } = await supabase.rpc(name, parameters);
  if (error) {
    console.error(name, error.message);
    throw new Error('Database operation failed');
  }
  return data as JsonObject | JsonObject[] | null;
}

function accountPlayers(value: unknown): AccountPlayer[] {
  if (Array.isArray(value)) return value as AccountPlayer[];
  if (!value || typeof value !== 'object') return [];
  const players = (value as JsonObject).players;
  return Array.isArray(players) ? players as AccountPlayer[] : [];
}

function accountOwnsPlayer(value: unknown, expectedKey: string) {
  return accountPlayers(value).some((player) => nickKey(player.nickKey ?? player.nick) === expectedKey);
}

async function accountHash(request: Request) {
  const token = request.headers.get('x-account-token')?.trim().toLowerCase() ?? '';
  return PRIVATE_TOKEN.test(token) ? await sha256(`account:${token}`) : null;
}

async function requireOwnedPlayer(request: Request, key: string) {
  const tokenHash = await accountHash(request);
  if (!tokenHash) return false;
  const account = await rpc('get_game_account_players', { p_account_token_hash: tokenHash });
  return accountOwnsPlayer(account, key);
}

async function authorizePlayer(request: Request, nick: string, deviceHash: string, ipHash: string) {
  const accountTokenHash = await accountHash(request);
  if (!accountTokenHash) return { error: 'account_token_required' };
  const legacyToken = request.headers.get('x-player-token')?.trim().toLowerCase() ?? '';
  const legacyTokenHash = PRIVATE_TOKEN.test(legacyToken) ? await sha256(`player:${legacyToken}`) : null;
  return await rpc('ensure_game_account_player', {
    p_nick: nick,
    p_nick_key: nickKey(nick),
    p_device_hash: deviceHash,
    p_ip_hash: ipHash,
    p_account_token_hash: accountTokenHash,
    p_legacy_token_hash: legacyTokenHash,
  }) as JsonObject;
}

function statusForError(error: string) {
  if (['league_identity_limit', 'league_full'].includes(error)) return 409;
  if (['player_access_denied', 'account_token_required', 'league_membership_required'].includes(error)) return 403;
  if (error === 'league_not_found') return 404;
  if (error === 'league_limit') return 429;
  return 400;
}

function messageForError(error: string) {
  const messages: Record<string, string> = {
    account_token_required: 'Necesitas la clave privada de tu cuenta.',
    invalid_input: 'Los datos de la liga no son válidos.',
    invalid_league_filter: 'El filtro de ligas no es válido.',
    invalid_league_name: 'El nombre debe tener entre 3 y 40 caracteres.',
    invalid_league_settings: 'El acceso, la duración o el máximo de participantes no son válidos.',
    league_finished: 'La liga ya ha finalizado.',
    league_full: 'La liga ha alcanzado su número máximo de participantes.',
    league_identity_limit: 'Esta cuenta o dispositivo ya ocupa una plaza en la liga.',
    league_limit: 'Has alcanzado el límite de ligas creadas durante los últimos siete días.',
    league_membership_required: 'Este nick no pertenece a la liga.',
    league_not_found: 'La liga no existe o la invitación privada no es válida.',
    player_access_denied: 'Este nick pertenece a otra cuenta o la clave no es válida.',
  };
  return messages[error] ?? 'No se pudo completar la operación con la liga.';
}

function safeResult(origin: string | null, result: JsonObject | JsonObject[] | null, status = 200) {
  const error = !Array.isArray(result) && result && typeof result === 'object' ? String(result.error ?? '') : '';
  return error
    ? jsonResponse(origin, { ...result, error: messageForError(error), code: error }, statusForError(error))
    : jsonResponse(origin, result, status);
}

Deno.serve(async (request) => {
  const origin = request.headers.get('origin');
  if (request.method === 'OPTIONS') {
    if (origin && !allowedOrigins.has(origin)) return new Response(null, { status: 403 });
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (request.method !== 'POST') return jsonResponse(origin, { error: 'Method not allowed.' }, 405);
  if (origin && !allowedOrigins.has(origin)) return jsonResponse(origin, { error: 'Origin not allowed.' }, 403);
  if (Number(request.headers.get('content-length') ?? 0) > 8_192) return jsonResponse(origin, { error: 'Request too large.' }, 413);

  try {
    const body = await request.json();
    const action = String(body?.action ?? '');
    if (!ACTIONS.has(action)) return jsonResponse(origin, { error: 'Acción desconocida.' }, 404);

    if (action === 'list-leagues') {
      const visibility = normalizeVisibility(body.visibility ?? 'all', true);
      if (!visibility) return safeResult(origin, { error: 'invalid_league_filter' });
      return safeResult(origin, await rpc('list_game_leagues', {
        p_search: String(body.search ?? '').trim().slice(0, 80),
        p_visibility: visibility,
        p_limit: 50,
        p_offset: 0,
      }));
    }

    if (action === 'league') {
      const publicId = normalizeLeagueId(body.publicId ?? body.code);
      if (!publicId) return safeResult(origin, { error: 'invalid_input' });
      const result = await rpc('get_game_public_league', { p_public_id: publicId }) as JsonObject;
      return Object.keys(result ?? {}).length > 0
        ? safeResult(origin, result)
        : safeResult(origin, { error: 'league_not_found' });
    }

    const deviceId = request.headers.get('x-device-id') ?? '';
    if (!DEVICE_ID.test(deviceId)) return jsonResponse(origin, { error: 'Identificador de dispositivo inválido.' }, 400);
    const [deviceHash, ipHash] = await Promise.all([
      sha256(`device:${deviceId}`),
      sha256(`ip:${clientIp(request)}`),
    ]);
    const nick = normalizeNick(body.nick);
    const key = nickKey(nick);
    if (nick.length < 2) return safeResult(origin, { error: 'invalid_input' });

    if (action === 'player-leagues' || action === 'league-status') {
      if (!(await requireOwnedPlayer(request, key))) return safeResult(origin, { error: 'player_access_denied' });
      if (action === 'player-leagues') {
        return safeResult(origin, await rpc('get_game_player_leagues', { p_nick_key: key }));
      }
      const publicId = normalizeLeagueId(body.publicId ?? body.code);
      if (!publicId) return safeResult(origin, { error: 'invalid_input' });
      return safeResult(origin, await rpc('get_game_league_player_status', {
        p_code: publicId,
        p_nick_key: key,
      }));
    }

    const moderation = moderateNickname(nick);
    if (!moderation.allowed) return jsonResponse(origin, { error: 'El nick no está permitido.' }, 400);
    const access = await authorizePlayer(request, nick, deviceHash, ipHash);
    if (access.error) return safeResult(origin, access);

    if (action === 'create-league') {
      const visibility = normalizeVisibility(body.visibility);
      const durationDays = normalizeInteger(body.durationDays, 1, 7);
      const maxParticipants = normalizeInteger(body.maxParticipants, 10, 100);
      if (!visibility || !durationDays || !maxParticipants || maxParticipants % 10 !== 0) {
        return safeResult(origin, { error: 'invalid_league_settings' });
      }
      return safeResult(origin, await rpc('create_game_league', {
        p_name: String(body.name ?? ''),
        p_owner_nick_key: key,
        p_device_hash: deviceHash,
        p_visibility: visibility,
        p_duration_days: durationDays,
        p_max_participants: maxParticipants,
      }), 201);
    }

    const code = body.code ? normalizeLeagueId(body.code) : null;
    const publicId = body.publicId ? normalizeLeagueId(body.publicId) : null;
    if ((code === null) === (publicId === null)) return safeResult(origin, { error: 'invalid_input' });
    return safeResult(origin, await rpc('join_game_league', {
      p_code: code,
      p_public_id: publicId,
      p_nick_key: key,
      p_device_hash: deviceHash,
    }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return jsonResponse(origin, { error: 'Error interno. Inténtalo de nuevo.' }, 500);
  }
});
