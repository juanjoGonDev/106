import { spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const DEFAULT_MAX_ATTEMPTS = 20;
const DEFAULT_DELAY_MS = 150;
const REQUEST_TIMEOUT_MS = 2_000;

export function parseSupabaseEnvironment(source) {
  const values = {};
  for (const line of String(source ?? '').split(/\r?\n/u)) {
    const match = line.match(/^([A-Z0-9_]+)=(?:"([^"]*)"|'([^']*)'|(.*))$/u);
    if (match) values[match[1]] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  return values;
}

function readLocalEnvironment() {
  const result = spawnSync('supabase', ['status', '-o', 'env'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`supabase status failed: ${result.stderr || result.stdout}`);

  const values = parseSupabaseEnvironment(result.stdout);
  const apiUrl = values.API_URL || values.SUPABASE_URL;
  const serviceRoleKey = values.SERVICE_ROLE_KEY;
  if (!apiUrl || !serviceRoleKey) throw new Error('Local Supabase API_URL or SERVICE_ROLE_KEY is missing.');
  return { apiUrl: apiUrl.replace(/\/$/u, ''), serviceRoleKey };
}

function readinessRequests(apiUrl) {
  return [
    {
      url: `${apiUrl}/rest/v1/rpc/get_game_stats`,
      body: {},
    },
    {
      url: `${apiUrl}/rest/v1/rpc/list_game_leagues`,
      body: {
        p_search: '',
        p_visibility: 'all',
        p_limit: 1,
        p_offset: 0,
      },
    },
  ];
}

async function probePostgrest({ apiUrl, serviceRoleKey, fetchImplementation }) {
  const headers = {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
    'content-type': 'application/json',
  };
  const responses = await Promise.all(readinessRequests(apiUrl).map(async ({ url, body }) => {
    const response = await fetchImplementation(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await response.text();
    return { ok: response.ok, status: response.status, text };
  }));
  return responses;
}

export async function waitForPostgrest({
  apiUrl,
  serviceRoleKey,
  fetchImplementation = fetch,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  delayMs = DEFAULT_DELAY_MS,
  sleepImplementation = sleep,
}) {
  let lastFailure = 'no response';
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const responses = await probePostgrest({ apiUrl, serviceRoleKey, fetchImplementation });
      if (responses.every((response) => response.ok)) return attempt;
      lastFailure = responses
        .filter((response) => !response.ok)
        .map((response) => `${response.status} ${response.text.slice(0, 160)}`)
        .join(' | ');
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
    }

    if (attempt < maxAttempts) await sleepImplementation(delayMs);
  }
  throw new Error(`Local PostgREST did not become ready after ${maxAttempts} probes: ${lastFailure}`);
}

export async function main() {
  const environment = readLocalEnvironment();
  const attempts = await waitForPostgrest(environment);
  process.stdout.write(`✓ local PostgREST RPC pool is ready after ${attempts} probe(s)\n`);
}

if (process.argv[1]?.endsWith('wait-for-postgrest-local.mjs')) await main();
