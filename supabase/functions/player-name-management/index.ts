import { createClient } from 'npm:@supabase/supabase-js@2.95.0';
import {
  evaluateNicknameCandidate,
  isNicknameCandidateError,
} from '../_shared/nickname-management.ts';

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

if (!supabaseUrl || !serviceKey || !hashPepper) throw new Error('Missing player-name-management environment variables.');

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const PRIVATE_TOKEN = /^[a-f0-9]{64}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 4_096;

type JsonObject = Record<string, unknown>;

type AccountPlayerState = {
  playerId: string;
  nick: string;
  nickKey: string;
  renameRequired?: boolean;
  originalNick?: string | null;
  temporaryNick?: string | null;
  cooldown?: JsonObject;
};

function corsHeaders(origin: string | null) {
  return {
    'Access-Control-Allow-Origin': origin && allowedOrigins.has(origin) ? origin : [...allowedOrigins][0],
    'Access-Control-Allow-Headers': 'content-type, x-account-token',
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

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${hashPepper}:${value}`));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function rpc(name: string, parameters: JsonObject = {}) {
  const { data, error } = await supabase.rpc(name, parameters);
  if (error) {
    console.error(JSON.stringify({ source: 'server', level: 'error', event: `player-name.${name}`, code: error.code }));
    throw new Error('Database operation failed');
  }
  return data as JsonObject | null;
}

async function accountTokenHash(request: Request) {
  const raw = request.headers.get('x-account-token')?.trim().toLowerCase() ?? '';
  if (!PRIVATE_TOKEN.test(raw)) return '';
  return sha256(`account:${raw}`);
}

async function accountPlayerStates(accountHash: string) {
  const result = await rpc('get_game_account_player_name_states', {
    p_account_token_hash: accountHash,
  });
  if (result?.error) return { error: String(result.error), players: [] as AccountPlayerState[] };
  return {
    error: '',
    players: (Array.isArray(result?.players) ? result.players : []) as AccountPlayerState[],
  };
}

function findOwnedPlayer(players: AccountPlayerState[], playerId: string) {
  return players.find((player) => player.playerId === playerId) ?? null;
}

async function candidateAvailability(candidate: { key: string }, playerId: string) {
  const { data, error } = await supabase
    .from('game_players')
    .select('player_id')
    .eq('nick_key', candidate.key)
    .maybeSingle();
  if (error) throw new Error('Could not check nickname availability');
  if (!data) return 'available';
  return String(data.player_id) === playerId ? 'owned' : 'occupied';
}

function mutationError(origin: string | null, result: JsonObject) {
  const code = String(result.error ?? 'nickname_error');
  if (code === 'nickname_cooldown') {
    const retryAfter = Math.max(1, Number(result.retryAfterSeconds) || 1);
    return jsonResponse(origin, {
      error: 'Este nick solo puede cambiarse una vez cada 7 días.',
      code,
      nextRenameAt: result.nextRenameAt ?? null,
      retryAfterSeconds: retryAfter,
    }, 429, { 'Retry-After': String(retryAfter) });
  }
  const status = code === 'player_access_denied' ? 403
    : ['nickname_taken', 'nickname_change_not_required', 'nickname_change_required', 'nickname_unchanged'].includes(code) ? 409
      : code === 'player_not_found' ? 404 : 400;
  const message = code === 'nickname_taken'
    ? 'Ese nick ya está ocupado.'
    : code === 'player_access_denied'
      ? 'Ese jugador no pertenece a esta cuenta.'
      : code === 'nickname_change_not_required'
        ? 'Este jugador ya no necesita cambiar el nick.'
        : code === 'nickname_change_required'
          ? 'Completa primero el cambio de nick requerido por moderación.'
          : code === 'nickname_unchanged'
            ? 'El nuevo nick debe ser distinto del actual.'
            : 'No se pudo cambiar el nick.';
  return jsonResponse(origin, { error: message, code }, status);
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
    const accountHash = await accountTokenHash(request);
    if (!accountHash) return jsonResponse(origin, { error: 'Necesitas una cuenta activa.', code: 'account_token_required' }, 401);
    const parsed = JSON.parse(source || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return jsonResponse(origin, { error: 'Solicitud no válida.' }, 400);
    const body = parsed as JsonObject;
    const action = String(body.action ?? '');

    if (action === 'status') {
      const requirement = await rpc('get_game_account_nickname_requirement', {
        p_account_token_hash: accountHash,
      });
      return jsonResponse(origin, { requirement });
    }

    if (action === 'list') {
      const result = await accountPlayerStates(accountHash);
      if (result.error) return jsonResponse(origin, { error: 'Necesitas una cuenta activa.', code: result.error }, 401);
      return jsonResponse(origin, { players: result.players });
    }

    if (action === 'check') {
      const playerId = String(body.playerId ?? '').trim();
      const nickname = evaluateNicknameCandidate(body.nick);
      if (!UUID.test(playerId)) return jsonResponse(origin, { error: 'Jugador no válido.', code: 'invalid_player' }, 400);
      if (isNicknameCandidateError(nickname)) {
        return jsonResponse(origin, { availability: nickname.error.replace(/^nick_/, 'invalid-'), error: nickname.message, code: nickname.error });
      }
      const states = await accountPlayerStates(accountHash);
      if (!findOwnedPlayer(states.players, playerId)) return jsonResponse(origin, { error: 'Ese jugador no pertenece a esta cuenta.', code: 'player_access_denied' }, 403);
      const availability = await candidateAvailability(nickname, playerId);
      return jsonResponse(origin, { availability, nick: nickname.nick, key: nickname.key });
    }

    if (action === 'rename' || action === 'complete') {
      const playerId = String(body.playerId ?? '').trim();
      const nickname = evaluateNicknameCandidate(body.nick);
      if (!UUID.test(playerId) || isNicknameCandidateError(nickname)) {
        return jsonResponse(origin, {
          error: isNicknameCandidateError(nickname) ? nickname.message : 'Solicitud de cambio no válida.',
          code: isNicknameCandidateError(nickname) ? nickname.error : 'invalid_request',
        }, 400);
      }

      const states = await accountPlayerStates(accountHash);
      const owned = findOwnedPlayer(states.players, playerId);
      if (!owned) return jsonResponse(origin, { error: 'Ese jugador no pertenece a esta cuenta.', code: 'player_access_denied' }, 403);
      if (owned.nick === nickname.nick && owned.nickKey === nickname.key) {
        return jsonResponse(origin, { error: 'El nuevo nick debe ser distinto del actual.', code: 'nickname_unchanged' }, 409);
      }
      const availability = await candidateAvailability(nickname, playerId);
      if (availability === 'occupied') return jsonResponse(origin, { error: 'Ese nick ya está ocupado.', code: 'nickname_taken' }, 409);

      const result = action === 'complete'
        ? await rpc('complete_game_player_required_rename', {
          p_account_token_hash: accountHash,
          p_player_id: playerId,
          p_new_nick: nickname.nick,
          p_new_nick_key: nickname.key,
        })
        : await rpc('rename_game_player_by_owner', {
          p_account_token_hash: accountHash,
          p_player_id: playerId,
          p_new_nick: nickname.nick,
          p_new_nick_key: nickname.key,
        });
      if (result?.error) return mutationError(origin, result);
      return jsonResponse(origin, result);
    }

    return jsonResponse(origin, { error: 'Acción desconocida.' }, 404);
  } catch (error) {
    console.error(JSON.stringify({
      source: 'server',
      level: 'error',
      event: 'player-name-management.request_failed',
      message: error instanceof Error ? error.message.slice(0, 240) : 'Unknown player-name-management error',
    }));
    return jsonResponse(origin, { error: 'No se pudo gestionar el nombre de jugador.' }, 500);
  }
});
