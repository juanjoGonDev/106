import { buildHostedAuthEmailConfig } from './auth-email-templates.mjs';

const DEFAULT_API_BASE_URL = 'https://api.supabase.com/v1/projects';
const MAX_ERROR_BODY_LENGTH = 600;

function normalizedEnvironmentValue(value) {
  return String(value ?? '').trim();
}

export function hostedAuthEmailSyncEnvironment(environment = process.env) {
  const projectId = normalizedEnvironmentValue(
    environment.SUPABASE_PROJECT_ID || environment.PROJECT_ID,
  );
  const accessToken = normalizedEnvironmentValue(environment.SUPABASE_ACCESS_TOKEN);
  if (!projectId) throw new Error('Missing SUPABASE_PROJECT_ID or PROJECT_ID.');
  if (!accessToken) throw new Error('Missing SUPABASE_ACCESS_TOKEN.');
  return Object.freeze({ projectId, accessToken });
}

export function hostedAuthEmailDrift(expectedValue, currentValue) {
  const expected = expectedValue && typeof expectedValue === 'object' ? expectedValue : {};
  const current = currentValue && typeof currentValue === 'object' ? currentValue : {};
  return Object.freeze(Object.keys(expected)
    .filter((key) => JSON.stringify(current[key]) !== JSON.stringify(expected[key]))
    .sort());
}

async function boundedResponseBody(response) {
  const body = await response.text().catch(() => '');
  return body.slice(0, MAX_ERROR_BODY_LENGTH).replaceAll(/\s+/gu, ' ').trim();
}

function customizationHint(status) {
  return [400, 403, 422].includes(status)
    ? ' Supabase may reject custom Auth templates for a newly created Free project using the default SMTP provider; configure custom SMTP or use an eligible plan.'
    : '';
}

async function requestHostedAuthConfig({ fetchFn, url, accessToken, method = 'GET', payload }) {
  const response = await fetchFn(url, {
    method,
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: 'application/json',
      ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  if (!response.ok) {
    const detail = await boundedResponseBody(response);
    const suffix = detail ? ` Response: ${detail}` : '';
    throw new Error(`Supabase Auth configuration ${method} failed with HTTP ${response.status}.${customizationHint(response.status)}${suffix}`);
  }
  if (method !== 'GET') return null;
  const body = await response.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Supabase Auth configuration GET returned an invalid JSON object.');
  }
  return body;
}

export async function synchronizeHostedAuthEmails({
  fetchFn = globalThis.fetch,
  projectId,
  accessToken,
  apply = false,
  expected = buildHostedAuthEmailConfig(),
  apiBaseUrl = DEFAULT_API_BASE_URL,
} = {}) {
  if (typeof fetchFn !== 'function') throw new Error('A fetch implementation is required.');
  const normalizedProjectId = normalizedEnvironmentValue(projectId);
  const normalizedAccessToken = normalizedEnvironmentValue(accessToken);
  if (!normalizedProjectId) throw new Error('A Supabase project ID is required.');
  if (!normalizedAccessToken) throw new Error('A Supabase access token is required.');
  const normalizedApiBaseUrl = normalizedEnvironmentValue(apiBaseUrl).replace(/\/$/u, '');
  if (!/^https?:\/\//u.test(normalizedApiBaseUrl)) throw new Error('A valid Supabase Management API base URL is required.');

  const url = `${normalizedApiBaseUrl}/${encodeURIComponent(normalizedProjectId)}/config/auth`;
  const current = await requestHostedAuthConfig({
    fetchFn,
    url,
    accessToken: normalizedAccessToken,
  });
  const drift = hostedAuthEmailDrift(expected, current);
  if (drift.length === 0) {
    return Object.freeze({ changed: false, drift, verified: true });
  }
  if (!apply) {
    throw new Error(`Hosted Supabase Auth email configuration drift detected in ${drift.length} managed keys: ${drift.join(', ')}`);
  }

  await requestHostedAuthConfig({
    fetchFn,
    url,
    accessToken: normalizedAccessToken,
    method: 'PATCH',
    payload: expected,
  });
  const verified = await requestHostedAuthConfig({
    fetchFn,
    url,
    accessToken: normalizedAccessToken,
  });
  const remaining = hostedAuthEmailDrift(expected, verified);
  if (remaining.length > 0) {
    throw new Error(`Hosted Supabase Auth email synchronization did not converge. Remaining managed keys: ${remaining.join(', ')}`);
  }
  return Object.freeze({ changed: true, drift, verified: true });
}
