const originalFetch = globalThis.fetch.bind(globalThis);
const testToken = process.env.LOCAL_E2E_TEST_TOKEN;

function parseRequest(input, init) {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') return null;
  if (!url.pathname.endsWith('/functions/v1/game-api')) return null;
  if (typeof init?.body !== 'string') return null;
  try {
    const body = JSON.parse(init.body);
    return body && typeof body === 'object' ? { url, body } : null;
  } catch {
    return null;
  }
}

function readyUrl(url) {
  const result = new URL(url);
  result.pathname = result.pathname.replace(/\/game-api$/, '/game-ready-api');
  return result;
}

function response(body, status) {
  return Response.json(body, {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

async function requestReady(url, init, body, extraHeaders = {}) {
  const headers = new Headers(init?.headers ?? {});
  headers.set('content-type', 'application/json');
  for (const [name, value] of Object.entries(extraHeaders)) headers.set(name, value);
  return originalFetch(readyUrl(url), {
    ...init,
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

if (!testToken) {
  throw new Error('LOCAL_E2E_TEST_TOKEN is required for the local human-check test bridge.');
}

globalThis.fetch = async (input, init = {}) => {
  const parsed = parseRequest(input, init);
  if (!parsed || !['human-check', 'complete-human-check'].includes(parsed.body.action)) {
    return originalFetch(input, init);
  }

  if (parsed.body.action === 'complete-human-check') {
    return requestReady(parsed.url, init, parsed.body);
  }

  const createdResponse = await requestReady(parsed.url, init, { action: 'human-check' });
  const created = await createdResponse.clone().json().catch(() => ({}));
  if (!createdResponse.ok) return createdResponse;

  const solutionResponse = await requestReady(parsed.url, init, {
    action: 'test-human-check-solution',
    checkId: created.checkId,
  }, { 'x-test-run-token': testToken });
  const solution = await solutionResponse.json().catch(() => ({}));
  if (!solutionResponse.ok || !Array.isArray(solution.balls)) {
    return response({ error: 'Local deterministic challenge solution is unavailable.' }, 500);
  }

  return response({ ...created, balls: solution.balls }, 201);
};
