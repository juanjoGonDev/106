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
const turnstileSecret = Deno.env.get('TURNSTILE_SECRET_KEY') ?? '';
const allowedOrigins = new Set(
  (Deno.env.get('ALLOWED_ORIGINS') ?? 'http://localhost:3000,http://127.0.0.1:3000,https://juanjogondev.github.io')
    .split(',').map((item) => item.trim()).filter(Boolean),
);
if (!supabaseUrl || !serviceKey || !hashPepper) throw new Error('Missing required Edge Function environment variables.');

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const READINESS_CONTRACT = 'prepared-countdown-v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRIVATE_TOKEN = /^[a-f0-9]{64}$/i;
const HUMAN_BALL_COUNT = 4;
const HUMAN_BALL_RADIUS = 8;
const HUMAN_BALL_MINIMUM_DISTANCE = 26;
const HUMAN_BALL_REPLACEMENT_DISTANCE = 12;

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
function normalizeTeam(value: unknown) { return value === 'spain' || value === 'argentina' ? value : null; }
function normalizeUuid(value: unknown) { const code = String(value ?? '').trim(); return UUID.test(code) ? code : null; }
function normalizeLeagueCode(value: unknown) {
  const code = String(value ?? '').trim().toUpperCase();
  return /^[A-Z0-9]{6}$/.test(code) ? code : null;
}
function secureRandom() {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] / 0x1_0000_0000;
}
function randomHex(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
function normalizePreviousBalls(value: unknown) {
  if (!Array.isArray(value) || value.length !== HUMAN_BALL_COUNT) return [];
  const balls = value.map((item) => {
    const input = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    const order = Number(input.order);
    const x = Number(input.x);
    const y = Number(input.y);
    if (!Number.isInteger(order) || order < 1 || order > HUMAN_BALL_COUNT
      || !Number.isFinite(x) || x < 0 || x > 100
      || !Number.isFinite(y) || y < 0 || y > 100) return null;
    return { order, x, y };
  });
  return balls.every(Boolean) ? balls as Array<{ order: number; x: number; y: number }> : [];
}
function createBallLayout(previousBalls: Array<{ order: number; x: number; y: number }> = []) {
  const balls: Array<{ order: number; x: number; y: number; radius: number }> = [];
  const fallback = [
    { x: 78, y: 72 },
    { x: 20, y: 75 },
    { x: 80, y: 25 },
    { x: 22, y: 28 },
  ];

  for (let order = 1; order <= HUMAN_BALL_COUNT; order += 1) {
    const previous = previousBalls.find((ball) => ball.order === order);
    let candidate = fallback[order - 1];
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const proposed = {
        x: 14 + secureRandom() * 72,
        y: 18 + secureRandom() * 64,
      };
      const separated = balls.every((ball) => Math.hypot(ball.x - proposed.x, ball.y - proposed.y) >= HUMAN_BALL_MINIMUM_DISTANCE);
      const moved = !previous || Math.hypot(previous.x - proposed.x, previous.y - proposed.y) >= HUMAN_BALL_REPLACEMENT_DISTANCE;
      if (separated && moved) {
        candidate = proposed;
        break;
      }
    }
    if (previous && Math.hypot(previous.x - candidate.x, previous.y - candidate.y) < HUMAN_BALL_REPLACEMENT_DISTANCE) {
      candidate = { x: 100 - previous.x, y: 100 - previous.y };
    }
    balls.push({
      order,
      x: Number(candidate.x.toFixed(2)),
      y: Number(candidate.y.toFixed(2)),
      radius: HUMAN_BALL_RADIUS,
    });
  }
  return balls;
}
function normalizeHumanClicks(value: unknown) {
  if (!Array.isArray(value) || value.length !== HUMAN_BALL_COUNT) return null;
  const clicks: Array<{ x: number; y: number; atMs: number; pointerType: string; trusted: boolean }> = [];
  let previousAt = -1;
  for (const item of value) {
    if (!item || typeof item !== 'object') return null;
    const input = item as Record<string, unknown>;
    const x = Number(input.x);
    const y = Number(input.y);
    const atMs = Math.round(Number(input.atMs));
    const pointerType = String(input.pointerType ?? '');
    if (!Number.isFinite(x) || x < 0 || x > 100
      || !Number.isFinite(y) || y < 0 || y > 100
      || !Number.isFinite(atMs) || atMs <= previousAt || atMs > 20_000
      || !['mouse', 'touch', 'pen'].includes(pointerType)
      || input.trusted !== true) return null;
    clicks.push({ x: Number(x.toFixed(2)), y: Number(y.toFixed(2)), atMs, pointerType, trusted: true });
    previousAt = atMs;
  }
  return clicks;
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
async function rpc(name: string, parameters = {}) {
  const { data, error } = await supabase.rpc(name, parameters);
  if (error) {
    console.error(name, error.message);
    throw new Error('Database operation failed');
  }
  return data;
}
function statusForError(error: string) {
  if (['challenge_used', 'challenge_already_activated', 'human_check_used', 'human_check_completed'].includes(error)) return 409;
  if (['device_mismatch', 'player_access_denied', 'league_membership_required', 'human_check_mismatch'].includes(error)) return 403;
  if (['rate_limit', 'daily_limit', 'human_check_rate_limit'].includes(error)) return 429;
  if (['challenge_not_found', 'human_check_not_found'].includes(error)) return 404;
  return 400;
}
function messageForError(error: string) {
  const messages: Record<string, string> = {
    invalid_input: 'Datos inválidos.',
    invalid_countdown: 'La cuenta atrás no es válida.',
    challenge_not_found: 'El intento preparado no existe.',
    challenge_used: 'Este intento ya fue utilizado.',
    challenge_expired: 'La preparación ha caducado. Repite la verificación.',
    challenge_not_prepared: 'El intento no está preparado.',
    challenge_not_activated: 'El intento todavía no ha comenzado.',
    challenge_already_activated: 'El intento ya fue iniciado.',
    device_mismatch: 'Debes continuar desde el mismo dispositivo.',
    account_token_required: 'Necesitas la clave privada de tu cuenta.',
    player_access_denied: 'Este nick pertenece a otra cuenta o la clave no es válida.',
    league_membership_required: 'Este nick no pertenece a la miniliga.',
    human_check_invalid: 'La verificación visual no es válida.',
    human_check_not_found: 'La verificación visual no existe.',
    human_check_expired: 'La verificación visual ha caducado. Repítela.',
    human_check_used: 'La verificación visual ya fue utilizada.',
    human_check_completed: 'La verificación visual ya fue completada.',
    human_check_incomplete: 'Completa la verificación visual antes de continuar.',
    human_check_mismatch: 'La verificación visual no pertenece a este dispositivo.',
    human_check_failed: 'El orden o las pulsaciones no son correctos.',
    human_check_rate_limit: 'Demasiadas verificaciones seguidas. Espera un momento.',
    nick_limit: 'Has agotado los intentos disponibles en esta competición.',
    rate_limit: 'Demasiadas acciones seguidas. Espera un momento.',
    daily_limit: 'Has alcanzado el límite diario de seguridad.',
  };
  return messages[error] ?? 'No se pudo preparar el intento.';
}
function safeResult(origin: string | null, result: Record<string, unknown>, status = 200) {
  return result?.error
    ? jsonResponse(origin, { ...result, error: messageForError(String(result.error)) }, statusForError(String(result.error)))
    : jsonResponse(origin, result, status);
}
async function getAccountHash(request: Request) {
  const rawToken = request.headers.get('x-account-token')?.trim().toLowerCase() ?? '';
  if (!PRIVATE_TOKEN.test(rawToken)) return null;
  return await sha256(`account:${rawToken}`);
}
async function authorizePlayer(request: Request, nick: string, deviceHash: string, ipHash: string) {
  const accountTokenHash = await getAccountHash(request);
  if (!accountTokenHash) return { error: 'account_token_required' };
  const rawLegacyToken = request.headers.get('x-player-token')?.trim().toLowerCase() ?? '';
  const legacyTokenHash = PRIVATE_TOKEN.test(rawLegacyToken) ? await sha256(`player:${rawLegacyToken}`) : null;
  return await rpc('ensure_game_account_player', {
    p_nick: nick,
    p_nick_key: nick.toLocaleLowerCase('es'),
    p_device_hash: deviceHash,
    p_ip_hash: ipHash,
    p_account_token_hash: accountTokenHash,
    p_legacy_token_hash: legacyTokenHash,
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
  if (Number(request.headers.get('content-length') ?? 0) > 16_384) return jsonResponse(origin, { error: 'Request too large.' }, 413);

  try {
    const body = await request.json();
    const action = String(body.action ?? '');
    if (action === 'health') {
      return jsonResponse(origin, { ok: true, contract: READINESS_CONTRACT });
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

    if (action === 'human-check') {
      const previousBalls = normalizePreviousBalls(body.previousBalls);
      const balls = createBallLayout(previousBalls);
      const result = await rpc('create_game_human_check', {
        p_device_hash: deviceHash,
        p_ip_hash: ipHash,
        p_balls: balls,
      });
      return safeResult(origin, { ...result, balls }, 201);
    }

    if (action === 'complete-human-check') {
      const checkId = normalizeUuid(body.checkId);
      const clicks = normalizeHumanClicks(body.clicks);
      if (!checkId || !clicks) return safeResult(origin, { error: 'human_check_invalid' });
      const proofToken = randomHex();
      const result = await rpc('complete_game_human_check', {
        p_check_id: checkId,
        p_device_hash: deviceHash,
        p_ip_hash: ipHash,
        p_clicks: clicks,
        p_proof_token_hash: await sha256(`human:${proofToken}`),
      });
      if (result.error) return safeResult(origin, result);
      return jsonResponse(origin, {
        checkId,
        proofToken,
        expiresAt: result.expiresAt,
      }, 201);
    }

    if (action === 'prepare-start') {
      const nick = normalizeNick(body.nick);
      const team = normalizeTeam(body.team);
      const requestedLeagueCode = String(body.leagueCode ?? '').trim();
      const leagueCode = requestedLeagueCode ? normalizeLeagueCode(requestedLeagueCode) : null;
      if (requestedLeagueCode && !leagueCode) return jsonResponse(origin, { error: 'Código de liga inválido.' }, 400);
      if (nick.length < 2 || !team) return safeResult(origin, { error: 'invalid_input' });
      const moderation = moderateNickname(nick);
      if (!moderation.allowed) return jsonResponse(origin, { error: 'El nick no está permitido.' }, 400);
      if (!(await verifyTurnstile(body.turnstileToken, ip))) {
        return jsonResponse(origin, { error: 'No se pudo completar la verificación anti-bots.' }, 400);
      }
      const humanCheckId = normalizeUuid(body.humanCheckId);
      const humanProofToken = String(body.humanProofToken ?? '').trim().toLowerCase();
      if (!humanCheckId || !PRIVATE_TOKEN.test(humanProofToken)) return safeResult(origin, { error: 'human_check_incomplete' });
      const humanCheck = await rpc('consume_game_human_check', {
        p_check_id: humanCheckId,
        p_device_hash: deviceHash,
        p_ip_hash: ipHash,
        p_proof_token_hash: await sha256(`human:${humanProofToken}`),
      });
      if (humanCheck.error) return safeResult(origin, humanCheck);
      const access = await authorizePlayer(request, nick, deviceHash, ipHash);
      if (access.error) return safeResult(origin, access);
      const game = await rpc('prepare_game_challenge_pointer_only', {
        p_nick: nick,
        p_nick_key: nick.toLocaleLowerCase('es'),
        p_team: team,
        p_device_hash: deviceHash,
        p_ip_hash: ipHash,
        p_referral_code: normalizeUuid(body.referralCode),
        p_league_code: leagueCode,
      });
      return safeResult(origin, {
        ...game,
        playerAccessCreated: access.created === true || access.claimed === true,
      }, 201);
    }

    if (action === 'activate-start') {
      const challengeId = normalizeUuid(body.challengeId);
      if (!challengeId) return safeResult(origin, { error: 'challenge_not_found' });
      return safeResult(origin, await rpc('activate_game_challenge_pointer_only', {
        p_challenge_id: challengeId,
        p_device_hash: deviceHash,
        p_ip_hash: ipHash,
        p_countdown_ms: Math.round(Number(body.countdownMs)),
      }));
    }

    return jsonResponse(origin, { error: 'Acción desconocida.' }, 404);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return jsonResponse(origin, { error: 'Error interno. Inténtalo de nuevo.' }, 500);
  }
});
