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
    if (body?.action !== 'player-context') {
      return jsonResponse(origin, { error: 'Acción desconocida.' }, 404);
    }

    const nick = normalizeNick(body.nick);
    const key = nickKey(nick);
    if (key.length < 2) return jsonResponse(origin, { error: 'Nick inválido.' }, 400);

    const profile = await rpc('get_game_player_profile', { p_nick_key: key }) as JsonObject;
    if (!profile?.nick) {
      return jsonResponse(origin, {
        availability: 'available',
        profile: null,
        leagues: [],
      });
    }

    const rawAccountToken = request.headers.get('x-account-token')?.trim().toLowerCase() ?? '';
    if (!PRIVATE_TOKEN.test(rawAccountToken)) {
      return jsonResponse(origin, {
        availability: 'occupied',
        profile,
        leagues: [],
      });
    }

    const accountTokenHash = await sha256(`account:${rawAccountToken}`);
    const account = await rpc('get_game_account_players', {
      p_account_token_hash: accountTokenHash,
    });
    const owned = playerBelongsToAccount(account, key);
    if (!owned) {
      return jsonResponse(origin, {
        availability: 'occupied',
        profile,
        leagues: [],
      });
    }

    const leagues = await rpc('get_game_player_leagues', { p_nick_key: key });
    return jsonResponse(origin, {
      availability: 'owned',
      profile,
      leagues: Array.isArray(leagues) ? leagues : [],
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return jsonResponse(origin, { error: 'Error interno. Inténtalo de nuevo.' }, 500);
  }
});
