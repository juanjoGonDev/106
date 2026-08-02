import { createClient } from 'npm:@supabase/supabase-js@2.95.0';
import { createHumanCheckLayout, renderHumanCheckRaster } from '../_shared/human-check-raster.js';
import {
  createTurnstilePolicy,
  TURNSTILE_MAX_AGE_SECONDS,
  TURNSTILE_RANKED_ACTION,
} from '../_shared/turnstile-policy.js';
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
if (!supabaseUrl || !serviceKey || !hashPepper) throw new Error('Missing required Edge Function environment variables.');

const allowedHostnames = [...allowedOrigins].flatMap((entry) => {
  try {
    return [new URL(entry).hostname];
  } catch {
    return [];
  }
});
const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const READINESS_CONTRACT = 'ranked-anti-cheat-v2';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRIVATE_TOKEN = /^[a-f0-9]{64}$/i;
const localSolutionEnabled = Deno.env.get('LOCAL_E2E_HUMAN_CHECK_SOLUTIONS') === 'true';
const localSolutionToken = Deno.env.get('LOCAL_E2E_TEST_TOKEN') ?? '';
const turnstilePolicy = createTurnstilePolicy({
  environment: Deno.env.get('APP_ENV'),
  required: Deno.env.get('TURNSTILE_REQUIRED'),
  testMode: Deno.env.get('TURNSTILE_TEST_MODE'),
  secret: Deno.env.get('TURNSTILE_SECRET_KEY'),
  expectedAction: Deno.env.get('TURNSTILE_EXPECTED_ACTION') ?? TURNSTILE_RANKED_ACTION,
  expectedHostnames: Deno.env.get('TURNSTILE_EXPECTED_HOSTNAMES') ?? allowedHostnames,
  maxAgeSeconds: TURNSTILE_MAX_AGE_SECONDS,
});

function corsHeaders(origin: string | null) {
  return {
    'Access-Control-Allow-Origin': origin && allowedOrigins.has(origin) ? origin : [...allowedOrigins][0],
    'Access-Control-Allow-Headers': 'content-type, x-device-id, x-account-token, x-player-token, x-test-run-token',
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
function normalizeHumanClick(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const x = Number(input.x);
  const y = Number(input.y);
  const atMs = Math.round(Number(input.atMs));
  const pointerType = ['mouse', 'touch', 'pen'].includes(String(input.pointerType))
    ? String(input.pointerType)
    : null;
  if (!Number.isFinite(x) || x < 0 || x > 100
    || !Number.isFinite(y) || y < 0 || y > 100
    || !Number.isFinite(atMs) || atMs < 1 || atMs > 20_000
    || !pointerType) return null;
  return {
    x: Number(x.toFixed(2)),
    y: Number(y.toFixed(2)),
    atMs,
    pointerType,
  };
}
function normalizeStateVersion(value: unknown) {
  const version = Number(value);
  return Number.isInteger(version) && version >= 0 && version <= 4 ? version : null;
}
function clientIp(request: Request) {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('cf-connecting-ip')
    || request.headers.get('x-real-ip')
    || 'unknown';
}
function isLocalOrigin(origin: string | null) {
  try {
    const hostname = new URL(String(origin ?? '')).hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
}
async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${hashPepper}:${value}`));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
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
  if (['challenge_used', 'challenge_already_activated', 'human_check_used', 'human_check_completed', 'human_check_stale', 'turnstile_replay'].includes(error)) return 409;
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
    human_check_stale: 'La verificación ya avanzó desde otra solicitud. Repítela.',
    human_check_incomplete: 'Completa la verificación visual antes de continuar.',
    human_check_mismatch: 'La verificación visual no pertenece a este dispositivo.',
    human_check_failed: 'El orden o las pulsaciones no son correctos.',
    human_check_rate_limit: 'Demasiadas verificaciones seguidas. Espera un momento.',
    nick_limit: 'Has agotado los intentos disponibles en esta competición.',
    rate_limit: 'Demasiadas acciones seguidas. Espera un momento.',
    daily_limit: 'Has alcanzado el límite diario de seguridad.',
    turnstile_replay: 'La verificación anti-bots ya fue utilizada. Repítela.',
    turnstile_invalid: 'La verificación anti-bots no es válida.',
  };
  return messages[error] ?? 'No se pudo preparar el intento.';
}
function safeResult(origin: string | null, result: Record<string, unknown>, status = 200) {
  return result?.error
    ? jsonResponse(origin, { ...result, error: messageForError(String(result.error)) }, statusForError(String(result.error)))
    : jsonResponse(origin, result, status);
}
function turnstileFailure(origin: string | null, code: string) {
  const configurationFailure = code === 'turnstile_configuration';
  return jsonResponse(origin, {
    code,
    error: configurationFailure
      ? 'La verificación anti-bots no está configurada de forma segura.'
      : 'No se pudo completar la verificación anti-bots.',
  }, configurationFailure ? 503 : 400);
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
      return jsonResponse(origin, {
        ok: true,
        contract: READINESS_CONTRACT,
        challengeFormat: 'raster-png-v1',
        progressiveHumanCheck: true,
        turnstileRequired: turnstilePolicy.required,
      });
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
      const balls = createHumanCheckLayout(secureRandom);
      const raster = await renderHumanCheckRaster(balls, { selectedCount: 0 });
      const result = await rpc('create_game_human_check_raster', {
        p_device_hash: deviceHash,
        p_ip_hash: ipHash,
        p_balls: balls,
      });
      if (result.error) return safeResult(origin, result);
      return jsonResponse(origin, {
        checkId: result.checkId,
        expiresAt: result.expiresAt,
        selectedCount: 0,
        stateVersion: 0,
        image: {
          mediaType: raster.mediaType,
          dataUrl: raster.dataUrl,
          width: raster.width,
          height: raster.height,
          digest: raster.digest,
        },
      }, 201);
    }

    if (action === 'test-human-check-solution') {
      if (!localSolutionEnabled) return jsonResponse(origin, { error: 'Not found.' }, 404);
      if (!isLocalOrigin(origin)) return jsonResponse(origin, { error: 'Forbidden.' }, 403);
      const suppliedToken = request.headers.get('x-test-run-token') ?? '';
      if (localSolutionToken.length < 16 || suppliedToken !== localSolutionToken) {
        return jsonResponse(origin, { error: 'Forbidden.' }, 403);
      }
      const checkId = normalizeUuid(body.checkId);
      if (!checkId) return safeResult(origin, { error: 'human_check_not_found' });
      return safeResult(origin, await rpc('get_game_human_check_solution_for_test', {
        p_check_id: checkId,
        p_device_hash: deviceHash,
      }));
    }

    if (action === 'human-check-click') {
      const checkId = normalizeUuid(body.checkId);
      const click = normalizeHumanClick(body.click);
      const expectedVersion = normalizeStateVersion(body.stateVersion);
      if (!checkId || !click || expectedVersion === null) {
        return safeResult(origin, { error: 'human_check_invalid' });
      }
      const proofToken = randomHex();
      const result = await rpc('advance_game_human_check_raster', {
        p_check_id: checkId,
        p_device_hash: deviceHash,
        p_ip_hash: ipHash,
        p_click: click,
        p_expected_version: expectedVersion,
        p_proof_token_hash: await sha256(`human:${proofToken}`),
      });
      if (result.error) return safeResult(origin, result);
      if (!Array.isArray(result.balls) || result.balls.length !== 4) {
        throw new Error('Progressive human-check RPC returned an invalid internal layout.');
      }
      const selectedCount = Number(result.selectedCount);
      const raster = await renderHumanCheckRaster(result.balls, { selectedCount });
      const response: Record<string, unknown> = {
        checkId,
        selectedCount,
        stateVersion: result.stateVersion,
        completed: result.completed === true,
        expiresAt: result.expiresAt,
        image: {
          mediaType: raster.mediaType,
          dataUrl: raster.dataUrl,
          width: raster.width,
          height: raster.height,
          digest: raster.digest,
        },
      };
      if (result.completed === true) response.proofToken = proofToken;
      return jsonResponse(origin, response, result.completed === true ? 201 : 200);
    }

    if (action === 'complete-human-check') {
      return jsonResponse(origin, {
        code: 'human_check_progressive_required',
        error: 'La verificación debe confirmarse una pulsación cada vez.',
      }, 410);
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

      const turnstile = await turnstilePolicy.verify({ token: body.turnstileToken, ip, origin });
      if (!turnstile.ok) return turnstileFailure(origin, turnstile.code);
      if (!turnstile.skipped) {
        const tokenResult = await rpc('consume_game_turnstile_token', {
          p_token_hash: await sha256(`turnstile:${turnstile.token}`),
          p_expires_at: new Date(
            (turnstile.challengeTime ?? Date.now()) + TURNSTILE_MAX_AGE_SECONDS * 1000,
          ).toISOString(),
        });
        if (tokenResult.error) return safeResult(origin, tokenResult);
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
