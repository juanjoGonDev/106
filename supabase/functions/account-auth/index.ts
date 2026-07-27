import { createClient } from 'npm:@supabase/supabase-js@2.95.0';

import {
  authIdentity,
  bearerToken,
  errorMessage,
  errorStatus,
  normalizeAction,
  normalizeDeviceId,
  normalizeFingerprint,
  normalizePrivateToken,
  normalizeUuid,
  publicAuth,
  successfulSync,
} from './core.js';

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

type JsonObject = Record<string, unknown>;

function corsHeaders(origin: string | null) {
  return {
    'Access-Control-Allow-Origin': origin && allowedOrigins.has(origin) ? origin : [...allowedOrigins][0],
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-account-token, x-device-id',
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
      'Cross-Origin-Resource-Policy': 'same-site',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function randomHex(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
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
    console.error(name, error.code);
    throw new Error('Database operation failed');
  }
  return data as JsonObject;
}

async function authenticatedIdentity(request: Request) {
  const token = bearerToken(request.headers.get('authorization'));
  if (!token) return { error: 'auth_required' } as const;

  const { data, error } = await supabase.auth.getUser(token);
  if (error) return { error: 'invalid_session' } as const;
  const identity = authIdentity(data.user);
  return identity ? { identity, token } as const : { error: 'invalid_session' } as const;
}

function safeResult(origin: string | null, result: JsonObject, status = 200) {
  const code = String(result?.error ?? '');
  if (!code) return jsonResponse(origin, result, status);
  return jsonResponse(origin, {
    ...result,
    error: errorMessage(code),
    code,
  }, errorStatus(code));
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
    const body = await request.json() as JsonObject;
    const action = normalizeAction(body.action);
    if (!action) return jsonResponse(origin, { error: 'Acción desconocida.' }, 404);

    const authenticated = await authenticatedIdentity(request);
    if ('error' in authenticated) {
      return safeResult(origin, { error: authenticated.error });
    }
    const { identity } = authenticated;

    if (action === 'session') {
      return jsonResponse(origin, { authenticated: true, auth: publicAuth(identity) });
    }

    if (action === 'sync-account') {
      const deviceId = normalizeDeviceId(request.headers.get('x-device-id'));
      if (!deviceId) return safeResult(origin, { error: 'invalid_input' });

      const currentToken = normalizePrivateToken(request.headers.get('x-account-token'));
      const newToken = randomHex();
      const [currentTokenHash, newTokenHash] = await Promise.all([
        currentToken ? sha256(`account:${currentToken}`) : Promise.resolve(''),
        sha256(`account:${newToken}`),
      ]);
      const result = await rpc('prepare_game_auth_link', {
        p_auth_user_id: identity.id,
        p_provider: identity.provider,
        p_email: identity.email || null,
        p_email_verified: identity.emailVerified,
        p_account_token_hash: currentTokenHash || null,
        p_new_token_hash: newTokenHash,
      });
      return safeResult(origin, successfulSync(result, newToken, identity));
    }

    const proposalId = normalizeUuid(body.proposalId);
    if (!proposalId) return safeResult(origin, { error: 'invalid_input' });

    if (action === 'cancel-merge') {
      return safeResult(origin, await rpc('cancel_game_auth_merge', {
        p_auth_user_id: identity.id,
        p_proposal_id: proposalId,
      }));
    }

    const fingerprint = normalizeFingerprint(body.fingerprint);
    if (!fingerprint) return safeResult(origin, { error: 'invalid_input' });
    const result = await rpc('confirm_game_auth_merge', {
      p_auth_user_id: identity.id,
      p_proposal_id: proposalId,
      p_impact_fingerprint: fingerprint,
    });
    return safeResult(origin, {
      ...result,
      auth: publicAuth(identity),
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Unknown account-auth error');
    return jsonResponse(origin, { error: 'Error interno. Inténtalo de nuevo.' }, 500);
  }
});
