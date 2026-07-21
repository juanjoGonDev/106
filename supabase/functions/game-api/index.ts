import { createClient } from 'npm:@supabase/supabase-js@2.95.0';
import { moderateNickname } from './moderation.ts';

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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRIVATE_TOKEN = /^[a-f0-9]{64}$/i;

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
function nickKey(value: unknown) { return normalizeNick(value).toLocaleLowerCase('es'); }
function normalizeTeam(value: unknown) { return value === 'spain' || value === 'argentina' ? value : null; }
function normalizeUuid(value: unknown) { const code = String(value ?? '').trim(); return UUID.test(code) ? code : null; }
function normalizeLeagueCode(value: unknown) {
  const code = String(value ?? '').trim().toUpperCase();
  return /^[A-Z0-9]{6}$/.test(code) ? code : null;
}
function boundedNumber(value: unknown, minimum: number, maximum: number, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}
function normalizeSignals(value: unknown) {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const mode = input.interactionMode === 'release' ? 'release' : input.interactionMode === 'press' ? 'press' : '';
  const finishEvent = ['pointerdown', 'pointerup', 'keydown'].includes(String(input.finishEvent))
    ? String(input.finishEvent)
    : '';
  const pointerType = ['mouse', 'touch', 'pen', 'keyboard'].includes(String(input.pointerType))
    ? String(input.pointerType)
    : 'unknown';
  return {
    trustedStart: input.trustedStart === true,
    trustedFinish: input.trustedFinish === true,
    timerConcealed: input.timerConcealed === true,
    visibilityChanges: Math.round(boundedNumber(input.visibilityChanges, 0, 20)),
    focusLosses: Math.round(boundedNumber(input.focusLosses, 0, 20)),
    interactionMode: mode,
    controlNonce: normalizeUuid(input.controlNonce) ?? '',
    finishEvent,
    pointerTrusted: input.pointerTrusted === true,
    userActivation: input.userActivation === true,
    automationDetected: input.automationDetected === true,
    pointerType,
    pointerXPercent: Number(boundedNumber(input.pointerXPercent, -1, 101, -1).toFixed(2)),
    pointerYPercent: Number(boundedNumber(input.pointerYPercent, -1, 101, -1).toFixed(2)),
    pointerMoveCount: Math.round(boundedNumber(input.pointerMoveCount, 0, 500)),
    pointerTravelPx: Math.round(boundedNumber(input.pointerTravelPx, 0, 5000)),
    pointerDwellMs: Math.round(boundedNumber(input.pointerDwellMs, 0, 30000)),
    pressureMax: Number(boundedNumber(input.pressureMax, 0, 1).toFixed(3)),
    holdDurationMs: Math.round(boundedNumber(input.holdDurationMs, 0, 3000)),
    samePointer: input.samePointer === true,
    keyboardKey: input.keyboardKey === 'Enter' ? 'Enter' : input.keyboardKey === ' ' ? ' ' : '',
  };
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
  if (['nick_limit', 'challenge_used', 'duel_closed'].includes(error)) return 409;
  if (['player_access_denied', 'league_membership_required'].includes(error)) return 403;
  if (['rate_limit', 'daily_limit', 'duel_daily_limit', 'league_limit'].includes(error)) return 429;
  if (['challenge_not_found', 'duel_not_found', 'league_not_found'].includes(error)) return 404;
  return 400;
}
function messageForError(error: string) {
  const messages: Record<string, string> = {
    invalid_input: 'Datos inválidos.',
    nick_limit: 'Has agotado los intentos disponibles en esta competición.',
    rate_limit: 'Demasiadas acciones seguidas. Espera un momento.',
    daily_limit: 'Has alcanzado el límite diario de seguridad.',
    challenge_not_found: 'El intento no existe.',
    challenge_used: 'Este intento ya fue utilizado.',
    challenge_expired: 'El intento ha caducado.',
    device_mismatch: 'Debes terminar desde el mismo dispositivo.',
    invalid_timing: 'La duración no es válida.',
    timing_mismatch: 'El tiempo no coincide con el comprobado por el servidor.',
    account_token_required: 'Necesitas la clave privada de tu cuenta.',
    player_access_denied: 'Este nick pertenece a otra cuenta o la clave no es válida.',
    player_claim_original_device: 'Este nick antiguo debe vincularse primero desde su dispositivo original.',
    no_verified_attempt: 'Necesitas al menos un intento global válido para crear un reto.',
    duel_daily_limit: 'Has creado demasiados retos hoy.',
    duel_not_found: 'El reto no existe.',
    duel_closed: 'El reto ya terminó o caducó.',
    duel_self: 'No puedes aceptar tu propio reto.',
    duel_incomplete: 'Completa los 5 intentos globales válidos del reto antes de comprobarlo.',
    invalid_league_name: 'El nombre de la liga no es válido.',
    league_limit: 'Has creado demasiadas ligas esta semana.',
    league_not_found: 'La miniliga no existe.',
    league_finished: 'La miniliga ya terminó.',
    league_membership_required: 'Este nick no pertenece a la miniliga. Únete desde la vista Miniligas.',
  };
  return messages[error] ?? 'No se pudo completar la operación.';
}
function safeResult(origin: string | null, result: Record<string, unknown>, status = 200) {
  return result?.error
    ? jsonResponse(origin, { ...result, error: messageForError(String(result.error)) }, statusForError(String(result.error)))
    : jsonResponse(origin, result, status);
}
function validateModeratedNick(origin: string | null, nick: string) {
  const moderation = moderateNickname(nick);
  if (moderation.allowed) return null;
  const error = moderation.reason === 'reserved'
    ? 'Este nick está reservado.'
    : 'El nick contiene lenguaje ofensivo o inapropiado.';
  return jsonResponse(origin, { error, code: `nick_${moderation.reason}` }, 400);
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
  const legacyTokenHash = PRIVATE_TOKEN.test(rawLegacyToken)
    ? await sha256(`player:${rawLegacyToken}`)
    : null;
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

    if (action === 'stats') {
      const [stats, awards] = await Promise.all([
        rpc('get_game_stats'),
        rpc('get_game_daily_awards'),
      ]);
      return jsonResponse(origin, { ...stats, awards });
    }
    if (['profile', 'public-profile', 'nick-status'].includes(action)) {
      const key = nickKey(body.nick);
      if (key.length < 2) return jsonResponse(origin, { error: 'Nick inválido.' }, 400);
      return jsonResponse(origin, await rpc('get_game_player_profile', { p_nick_key: key }));
    }
    if (action === 'access-status') {
      const nick = normalizeNick(body.nick);
      if (nick.length < 2) return jsonResponse(origin, { error: 'Nick inválido.' }, 400);
      const moderationError = validateModeratedNick(origin, nick);
      if (moderationError) return moderationError;
      return jsonResponse(origin, await rpc('get_game_player_access_status', {
        p_nick_key: nick.toLocaleLowerCase('es'),
      }));
    }
    if (action === 'league') {
      const code = normalizeLeagueCode(body.code);
      if (!code) return jsonResponse(origin, { error: 'Código de liga inválido.' }, 400);
      return safeResult(origin, await rpc('get_game_league', { p_code: code }));
    }
    if (action === 'account-players') {
      const accountTokenHash = await getAccountHash(request);
      if (!accountTokenHash) return safeResult(origin, { error: 'account_token_required' });
      return jsonResponse(origin, await rpc('get_game_account_players', {
        p_account_token_hash: accountTokenHash,
      }));
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

    if (action === 'start' || action === 'link-account-player') {
      const nick = normalizeNick(body.nick);
      const team = action === 'start' ? normalizeTeam(body.team) : null;
      const requestedLeagueCode = String(body.leagueCode ?? '').trim();
      const leagueCode = requestedLeagueCode ? normalizeLeagueCode(requestedLeagueCode) : null;
      if (requestedLeagueCode && !leagueCode) return jsonResponse(origin, { error: 'Código de liga inválido.' }, 400);
      if (nick.length < 2 || (action === 'start' && !team)) {
        return jsonResponse(origin, { error: 'Nick o selección inválidos.' }, 400);
      }
      const moderationError = validateModeratedNick(origin, nick);
      if (moderationError) return moderationError;
      const access = await authorizePlayer(request, nick, deviceHash, ipHash);
      if (access.error) return safeResult(origin, access);
      if (action === 'link-account-player') return jsonResponse(origin, access);

      if (!(await verifyTurnstile(body.turnstileToken, ip))) {
        return jsonResponse(origin, { error: 'No se pudo completar la verificación anti-bots.' }, 400);
      }
      const game = await rpc('start_game_challenge', {
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

    if (action === 'finish') {
      const challengeId = normalizeUuid(body.challengeId);
      const clientElapsedMs = Math.round(Number(body.clientElapsedMs));
      if (!challengeId || !Number.isFinite(clientElapsedMs)) {
        return jsonResponse(origin, { error: 'Intento inválido.' }, 400);
      }
      const result = await rpc('finish_game_attempt', {
        p_challenge_id: challengeId,
        p_client_elapsed_ms: clientElapsedMs,
        p_device_hash: deviceHash,
        p_ip_hash: ipHash,
        p_client_signals: normalizeSignals(body.clientSignals),
      });
      if (result.error) return safeResult(origin, result);
      const key = nickKey(result.attempt?.nick);
      const leagueCode = normalizeLeagueCode(result.competition?.code);
      const [stats, profile, league] = await Promise.all([
        rpc('get_game_stats'),
        rpc('get_game_player_profile', { p_nick_key: key }),
        leagueCode ? rpc('get_game_league', { p_code: leagueCode }) : Promise.resolve(null),
      ]);
      const isGlobal = result.competition?.type !== 'league';
      const topIndex = isGlobal && Array.isArray(stats.leaderboard)
        ? stats.leaderboard.findIndex((entry: Record<string, unknown>) => entry.id === result.attempt?.id)
        : -1;
      const leagueEntry = !isGlobal && Array.isArray(league?.leaderboard)
        ? league.leaderboard.find((entry: Record<string, unknown>) => nickKey(entry.nick) === key)
        : null;
      const leagueRank = Number(leagueEntry?.rank) || null;
      const achievement = {
        enteredTop10: isGlobal && result.attempt?.verified === true && Number(profile.globalRankBest) <= 10,
        topPosition: isGlobal ? (topIndex >= 0 ? topIndex + 1 : Number(profile.globalRankBest) || null) : null,
        isWorldRecord: isGlobal
          && result.attempt?.verified === true
          && Number(profile.globalRankBest) === 1
          && Number(result.attempt?.differenceMs) === Number(profile.bestDifferenceMs),
        leagueRank,
        isLeagueLeader: !isGlobal && result.attempt?.verified === true && leagueRank === 1,
        completedSet: Number(result.attemptsLeft) === 0,
      };
      return jsonResponse(origin, { ...result, stats, profile, league, achievement }, 201);
    }

    const nick = normalizeNick(body.nick);
    if (nick.length < 2) return jsonResponse(origin, { error: 'Nick inválido.' }, 400);
    const moderationError = validateModeratedNick(origin, nick);
    if (moderationError) return moderationError;
    const key = nick.toLocaleLowerCase('es');
    const access = await authorizePlayer(request, nick, deviceHash, ipHash);
    if (access.error) return safeResult(origin, access);

    if (action === 'player-leagues') {
      return jsonResponse(origin, await rpc('get_game_player_leagues', { p_nick_key: key }));
    }
    if (action === 'league-status') {
      const code = normalizeLeagueCode(body.code);
      if (!code) return jsonResponse(origin, { error: 'Código de liga inválido.' }, 400);
      return safeResult(origin, await rpc('get_game_league_player_status', {
        p_code: code,
        p_nick_key: key,
      }));
    }
    if (action === 'create-duel') {
      return safeResult(origin, await rpc('create_game_duel', {
        p_nick_key: key,
        p_device_hash: deviceHash,
        p_ip_hash: ipHash,
      }), 201);
    }
    if (action === 'resolve-duel') {
      const code = normalizeUuid(body.code);
      if (!code) return jsonResponse(origin, { error: 'Código de reto inválido.' }, 400);
      return safeResult(origin, await rpc('resolve_game_duel', {
        p_code: code,
        p_opponent_nick_key: key,
        p_device_hash: deviceHash,
        p_ip_hash: ipHash,
      }));
    }
    if (action === 'create-league') {
      return safeResult(origin, await rpc('create_game_league', {
        p_name: String(body.name ?? '').trim().slice(0, 40),
        p_owner_nick_key: key,
        p_device_hash: deviceHash,
      }), 201);
    }
    if (action === 'join-league') {
      const code = normalizeLeagueCode(body.code);
      if (!code) return jsonResponse(origin, { error: 'Código de liga inválido.' }, 400);
      return safeResult(origin, await rpc('join_game_league', {
        p_code: code,
        p_nick_key: key,
      }));
    }
    return jsonResponse(origin, { error: 'Acción desconocida.' }, 404);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return jsonResponse(origin, { error: 'Error interno. Inténtalo de nuevo.' }, 500);
  }
});
