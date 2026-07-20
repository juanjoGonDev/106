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
const turnstileSecret = Deno.env.get('TURNSTILE_SECRET_KEY') ?? '';
const allowedOrigins = new Set(
  (Deno.env.get('ALLOWED_ORIGINS') ?? 'http://localhost:3000,http://127.0.0.1:3000,https://juanjogondev.github.io')
    .split(',').map((origin) => origin.trim()).filter(Boolean),
);

if (!supabaseUrl || !serviceKey || !hashPepper) {
  throw new Error('Missing required Edge Function environment variables.');
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function corsHeaders(origin: string | null) {
  const allowedOrigin = origin && allowedOrigins.has(origin) ? origin : [...allowedOrigins][0];
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'content-type, x-device-id',
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

function normalizeTeam(value: unknown) {
  return value === 'spain' || value === 'argentina' ? value : null;
}

function clientIp(request: Request) {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('cf-connecting-ip')
    || request.headers.get('x-real-ip')
    || 'unknown';
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(`${hashPepper}:${value}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function verifyTurnstile(token: unknown, ip: string) {
  if (!turnstileSecret) return true;
  if (typeof token !== 'string' || !token) return false;
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ secret: turnstileSecret, response: token, remoteip: ip }),
  });
  const result = await response.json();
  return response.ok && result.success === true;
}

function statusForError(error: string) {
  if (error === 'nick_limit' || error === 'challenge_used') return 409;
  if (error === 'rate_limit' || error === 'daily_limit') return 429;
  if (error === 'challenge_not_found') return 404;
  return 400;
}

function messageForError(error: string) {
  const messages: Record<string, string> = {
    invalid_input: 'Datos de partida inválidos.',
    nick_limit: 'Este nick ya ha agotado sus 5 intentos. Puedes competir de nuevo con otro nick.',
    rate_limit: 'Demasiados intentos seguidos. Espera un momento.',
    daily_limit: 'Este dispositivo ha alcanzado el límite diario de seguridad.',
    challenge_not_found: 'El reto no existe o ya no está disponible.',
    challenge_used: 'Este reto ya fue utilizado.',
    challenge_expired: 'El reto ha caducado. Inicia uno nuevo.',
    device_mismatch: 'El reto debe terminarse desde el mismo dispositivo.',
    invalid_timing: 'El intento no tiene una duración válida.',
    timing_mismatch: 'El tiempo enviado no coincide con el comprobado por el servidor.',
  };
  return messages[error] ?? 'No se pudo validar el intento.';
}

async function rpc(name: string, parameters = {}) {
  const { data, error } = await supabase.rpc(name, parameters);
  if (error) {
    console.error(name, error);
    throw new Error('Database operation failed');
  }
  return data;
}

Deno.serve(async (request) => {
  const origin = request.headers.get('origin');

  if (request.method === 'OPTIONS') {
    if (origin && !allowedOrigins.has(origin)) return new Response(null, { status: 403 });
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (request.method !== 'POST') return jsonResponse(origin, { error: 'Method not allowed.' }, 405);
  if (origin && !allowedOrigins.has(origin)) return jsonResponse(origin, { error: 'Origin not allowed.' }, 403);
  if (Number(request.headers.get('content-length') ?? 0) > 8_192) {
    return jsonResponse(origin, { error: 'Request too large.' }, 413);
  }

  try {
    const body = await request.json();
    const action = String(body.action ?? '');

    if (action === 'stats') return jsonResponse(origin, await rpc('get_game_stats'));

    if (action === 'nick-status') {
      const nick = normalizeNick(body.nick);
      if (nick.length < 2) return jsonResponse(origin, { error: 'Nick inválido.' }, 400);
      const status = await rpc('get_game_nick_status', { p_nick_key: nick.toLocaleLowerCase('es') });
      return jsonResponse(origin, { nick, ...status });
    }

    const deviceId = request.headers.get('x-device-id') ?? '';
    if (!/^[a-zA-Z0-9._:-]{16,80}$/.test(deviceId)) {
      return jsonResponse(origin, { error: 'Identificador de dispositivo inválido.' }, 400);
    }

    const ip = clientIp(request);
    const [deviceHash, ipHash] = await Promise.all([
      sha256(`device:${deviceId}`),
      sha256(`ip:${ip}`),
    ]);

    if (action === 'start') {
      const nick = normalizeNick(body.nick);
      const team = normalizeTeam(body.team);
      if (nick.length < 2 || !team) return jsonResponse(origin, { error: 'Nick o selección inválidos.' }, 400);
      if (!(await verifyTurnstile(body.turnstileToken, ip))) {
        return jsonResponse(origin, { error: 'No se pudo completar la verificación anti-bots.' }, 400);
      }
      const result = await rpc('start_game_challenge', {
        p_nick: nick,
        p_nick_key: nick.toLocaleLowerCase('es'),
        p_team: team,
        p_device_hash: deviceHash,
        p_ip_hash: ipHash,
      });
      if (result.error) {
        return jsonResponse(origin, { error: messageForError(result.error), attemptsLeft: result.attemptsLeft }, statusForError(result.error));
      }
      return jsonResponse(origin, result, 201);
    }

    if (action === 'finish') {
      const challengeId = String(body.challengeId ?? '');
      const clientElapsedMs = Math.round(Number(body.clientElapsedMs));
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(challengeId)) {
        return jsonResponse(origin, { error: 'Identificador de reto inválido.' }, 400);
      }
      if (!Number.isFinite(clientElapsedMs)) return jsonResponse(origin, { error: 'Tiempo inválido.' }, 400);
      const result = await rpc('finish_game_attempt', {
        p_challenge_id: challengeId,
        p_client_elapsed_ms: clientElapsedMs,
        p_device_hash: deviceHash,
        p_ip_hash: ipHash,
      });
      if (result.error) {
        return jsonResponse(origin, { error: messageForError(result.error), attemptsLeft: result.attemptsLeft }, statusForError(result.error));
      }
      return jsonResponse(origin, { ...result, stats: await rpc('get_game_stats') }, 201);
    }

    return jsonResponse(origin, { error: 'Acción desconocida.' }, 404);
  } catch (error) {
    console.error(error);
    return jsonResponse(origin, { error: 'Error interno. Inténtalo de nuevo.' }, 500);
  }
});
