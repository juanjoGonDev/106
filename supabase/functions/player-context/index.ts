import { createClient } from 'npm:@supabase/supabase-js@2.95.0';

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
const ACHIEVEMENT_CODE = /^[a-z0-9_]{1,120}$/;
const MAX_FEATURED_ACHIEVEMENTS = 3;
const ACTIONS = new Set(['player-context', 'set-featured-achievements']);

type JsonObject = Record<string, unknown>;

type AccountPlayer = {
  nick?: unknown;
  nickKey?: unknown;
};

function corsHeaders(origin: string | null) {
  return {
    'Access-Control-Allow-Origin': origin && allowedOrigins.has(origin) ? origin : [...allowedOrigins][0],
    'Access-Control-Allow-Headers': 'content-type, x-account-token',
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
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 24);
}

function nickKey(value: unknown) {
  return normalizeNick(value).toLocaleLowerCase('es');
}

function normalizeAchievementCodes(value: unknown) {
  if (!Array.isArray(value) || value.length > MAX_FEATURED_ACHIEVEMENTS) return null;
  const codes = value.map((item) => String(item ?? '').trim());
  if (codes.some((code) => !ACHIEVEMENT_CODE.test(code))) return null;
  return new Set(codes).size === codes.length ? codes : null;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${hashPepper}:${value}`),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function rpc(name: string, parameters: JsonObject) {
  const { data, error } = await supabase.rpc(name, parameters);
  if (error) {
    console.error(name, error.message);
    throw new Error('Database operation failed');
  }
  return data;
}

function accountPlayers(value: unknown): AccountPlayer[] {
  if (Array.isArray(value)) return value as AccountPlayer[];
  if (!value || typeof value !== 'object') return [];
  const players = (value as JsonObject).players;
  return Array.isArray(players) ? players as AccountPlayer[] : [];
}

function playerBelongsToAccount(value: unknown, expectedKey: string) {
  return accountPlayers(value).some((player) => {
    const candidate = player.nickKey ?? player.nick;
    return nickKey(candidate) === expectedKey;
  });
}

async function accountOwnership(request: Request, key: string) {
  const rawAccountToken = request.headers.get('x-account-token')?.trim().toLowerCase() ?? '';
  if (!PRIVATE_TOKEN.test(rawAccountToken)) return false;
  const accountTokenHash = await sha256(`account:${rawAccountToken}`);
  const account = await rpc('get_game_account_players', {
    p_account_token_hash: accountTokenHash,
  });
  return playerBelongsToAccount(account, key);
}

async function loadPlayerContext(request: Request, key: string) {
  const profile = await rpc('get_game_player_profile', { p_nick_key: key }) as JsonObject;
  if (!profile?.nick) {
    return {
      availability: 'available',
      profile: null,
      leagues: [],
    };
  }

  const owned = await accountOwnership(request, key);
  if (!owned) {
    return {
      availability: 'occupied',
      profile,
      leagues: [],
    };
  }

  const leagues = await rpc('get_game_player_leagues', { p_nick_key: key });
  return {
    availability: 'owned',
    profile,
    leagues: Array.isArray(leagues) ? leagues : [],
  };
}

function featuredErrorMessage(code: string) {
  const messages: Record<string, string> = {
    featured_limit: 'Puedes destacar como máximo tres logros.',
    invalid_featured_achievement: 'La selección contiene un logro no válido.',
    duplicate_featured_achievement: 'No puedes destacar el mismo logro más de una vez.',
    achievement_not_unlocked: 'Solo puedes destacar logros que ya hayas desbloqueado.',
    player_not_found: 'No se encontró el jugador.',
  };
  return messages[code] ?? 'No se pudieron actualizar los logros destacados.';
}

Deno.serve(async (request) => {
  const origin = request.headers.get('origin');
  if (request.method === 'OPTIONS') {
    if (origin && !allowedOrigins.has(origin)) return new Response(null, { status: 403 });
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (request.method !== 'POST') return jsonResponse(origin, { error: 'Method not allowed.' }, 405);
  if (origin && !allowedOrigins.has(origin)) return jsonResponse(origin, { error: 'Origin not allowed.' }, 403);
  if (Number(request.headers.get('content-length') ?? 0) > 4_096) {
    return jsonResponse(origin, { error: 'Request too large.' }, 413);
  }

  try {
    const body = await request.json();
    const action = String(body?.action ?? '');
    if (!ACTIONS.has(action)) {
      return jsonResponse(origin, { error: 'Acción desconocida.' }, 404);
    }

    const nick = normalizeNick(body.nick);
    const key = nickKey(nick);
    if (key.length < 2) return jsonResponse(origin, { error: 'Nick inválido.' }, 400);

    if (action === 'player-context') {
      return jsonResponse(origin, await loadPlayerContext(request, key));
    }

    const codes = normalizeAchievementCodes(body.achievementCodes);
    if (!codes) {
      return jsonResponse(origin, { error: 'Selecciona hasta tres logros diferentes y válidos.' }, 400);
    }
    if (!(await accountOwnership(request, key))) {
      return jsonResponse(origin, { error: 'Este nick pertenece a otra cuenta o la clave no es válida.' }, 403);
    }

    const result = await rpc('set_game_player_featured_achievements', {
      p_nick_key: key,
      p_achievement_codes: codes,
    }) as JsonObject;
    if (result?.error) {
      return jsonResponse(origin, {
        error: featuredErrorMessage(String(result.error)),
        code: result.error,
      }, 400);
    }

    return jsonResponse(origin, await loadPlayerContext(request, key));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return jsonResponse(origin, { error: 'Error interno. Inténtalo de nuevo.' }, 500);
  }
});
