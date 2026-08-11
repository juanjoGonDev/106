import { createClient } from 'npm:@supabase/supabase-js@2.95.0';
import { nicknameErrorMessage, normalizeNickname } from '../_shared/nickname-policy.js';
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

type JsonObject = Record<string, unknown>;

function corsHeaders(origin: string | null) {
  return {
    'Access-Control-Allow-Origin': origin && allowedOrigins.has(origin) ? origin : [...allowedOrigins][0],
    'Access-Control-Allow-Headers': 'content-type, x-account-token',
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

function moderatedNickname(value: unknown) {
  const moderation = moderateNickname(value);
  if (!moderation.allowed) {
    const reason = String(moderation.reason ?? 'invalid');
    return { error: `nick_${reason}`, message: nicknameErrorMessage(reason) } as const;
  }
  const nick = normalizeNickname(moderation.normalized);
  const key = nick.toLocaleLowerCase('es');
  if (nick.length < 2 || nick.length > 24 || key.length < 2 || key.length > 24) {
    return { error: 'nick_invalid', message: 'El nick no es válido.' } as const;
  }
  return { nick, key } as const;
}

Deno.serve(async (request) => {
  const origin = request.headers.get('origin');
  if (request.method === 'OPTIONS') {
    if (origin && !allowedOrigins.has(origin)) return new Response(null, { status: 403 });
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (request.method !== 'POST') return jsonResponse(origin, { error: 'Method not allowed.' }, 405);
  if (origin && !allowedOrigins.has(origin)) return jsonResponse(origin, { error: 'Origin not allowed.' }, 403);
  if (Number(request.headers.get('content-length') ?? 0) > 4_096) return jsonResponse(origin, { error: 'Request too large.' }, 413);

  try {
    const accountHash = await accountTokenHash(request);
    if (!accountHash) return jsonResponse(origin, { error: 'Necesitas una cuenta activa.', code: 'account_token_required' }, 401);
    const body = await request.json() as JsonObject;
    const action = String(body.action ?? '');

    if (action === 'status') {
      const requirement = await rpc('get_game_account_nickname_requirement', {
        p_account_token_hash: accountHash,
      });
      return jsonResponse(origin, { requirement });
    }

    if (action === 'complete') {
      const playerId = String(body.playerId ?? '').trim();
      const nickname = moderatedNickname(body.nick);
      if (!UUID.test(playerId) || 'error' in nickname) {
        return jsonResponse(origin, {
          error: 'error' in nickname ? nickname.message : 'Solicitud de cambio no válida.',
          code: 'error' in nickname ? nickname.error : 'invalid_request',
        }, 400);
      }
      const result = await rpc('complete_game_player_required_rename', {
        p_account_token_hash: accountHash,
        p_player_id: playerId,
        p_new_nick: nickname.nick,
        p_new_nick_key: nickname.key,
      });
      if (result?.error) {
        const code = String(result.error);
        const status = code === 'player_access_denied' ? 403
          : code === 'nickname_taken' ? 409
            : code === 'nickname_change_not_required' ? 409 : 400;
        const message = code === 'nickname_taken'
          ? 'Ese nick ya está ocupado.'
          : code === 'player_access_denied'
            ? 'Ese jugador no pertenece a esta cuenta.'
            : code === 'nickname_change_not_required'
              ? 'Este jugador ya no necesita cambiar el nick.'
              : 'No se pudo completar el cambio de nick.';
        return jsonResponse(origin, { error: message, code }, status);
      }
      return jsonResponse(origin, result);
    }

    return jsonResponse(origin, { error: 'Acción desconocida.' }, 404);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Unknown player-name-management error');
    return jsonResponse(origin, { error: 'No se pudo comprobar el nombre de jugador.' }, 500);
  }
});
