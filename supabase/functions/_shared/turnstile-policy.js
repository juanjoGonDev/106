export const TURNSTILE_RANKED_ACTION = 'ranked-attempt';
export const TURNSTILE_MAX_AGE_SECONDS = 300;

function parseBoolean(value) {
  return String(value ?? '').trim().toLowerCase() === 'true';
}

function normalizeHostnames(value) {
  const entries = Array.isArray(value) ? value : String(value ?? '').split(',');
  return new Set(entries.map((entry) => String(entry).trim().toLowerCase()).filter(Boolean));
}

function isLocalOrigin(origin) {
  try {
    const hostname = new URL(String(origin ?? '')).hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
}

function failure(code, providerErrors = []) {
  return Object.freeze({ ok: false, code, providerErrors: Object.freeze([...providerErrors]) });
}

function success(details = {}) {
  return Object.freeze({ ok: true, ...details });
}

export function createTurnstilePolicy(options = {}) {
  const environment = String(options.environment ?? '').trim().toLowerCase();
  const required = environment === 'production' || parseBoolean(options.required);
  const testMode = parseBoolean(options.testMode);
  const secret = String(options.secret ?? '').trim();
  const expectedAction = String(options.expectedAction ?? TURNSTILE_RANKED_ACTION).trim();
  const expectedHostnames = normalizeHostnames(options.expectedHostnames);
  const maxAgeSeconds = Math.max(1, Math.min(600, Number(options.maxAgeSeconds) || TURNSTILE_MAX_AGE_SECONDS));
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const now = options.now ?? (() => Date.now());

  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
  if (typeof now !== 'function') throw new TypeError('now must be a function');

  async function verify({ token, ip, origin }) {
    const normalizedToken = typeof token === 'string' ? token.trim() : '';

    if (testMode) {
      if (!isLocalOrigin(origin)) return failure('turnstile_test_origin');
      if (!/^test-valid:[A-Za-z0-9_-]{8,96}$/.test(normalizedToken)) return failure('turnstile_invalid');
      return success({ token: normalizedToken, testMode: true });
    }

    if (!secret) {
      return required ? failure('turnstile_configuration') : success({ skipped: true });
    }
    if (!normalizedToken) return failure('turnstile_missing');

    let response;
    try {
      response = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ secret, response: normalizedToken, remoteip: String(ip ?? '') }),
      });
    } catch {
      return failure('turnstile_unavailable');
    }

    let result;
    try {
      result = await response.json();
    } catch {
      return failure('turnstile_invalid_response');
    }
    const providerErrors = Array.isArray(result?.['error-codes']) ? result['error-codes'].map(String) : [];
    if (!response.ok || result?.success !== true) return failure('turnstile_rejected', providerErrors);
    if (String(result.action ?? '') !== expectedAction) return failure('turnstile_action', providerErrors);

    const hostname = String(result.hostname ?? '').trim().toLowerCase();
    if (expectedHostnames.size > 0 && !expectedHostnames.has(hostname)) {
      return failure('turnstile_hostname', providerErrors);
    }

    const challengeTime = Date.parse(String(result.challenge_ts ?? ''));
    const ageMs = now() - challengeTime;
    if (!Number.isFinite(challengeTime) || ageMs < -30_000 || ageMs > maxAgeSeconds * 1000) {
      return failure('turnstile_expired', providerErrors);
    }

    return success({ token: normalizedToken, hostname, action: expectedAction, challengeTime });
  }

  return Object.freeze({ required, testMode, verify });
}
