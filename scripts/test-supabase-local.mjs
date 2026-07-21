import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const endpoint = process.env.SUPABASE_FUNCTION_URL
  ?? 'http://127.0.0.1:54321/functions/v1/game-api';
const origin = 'http://127.0.0.1:3000';
const smokeOnly = process.env.SUPABASE_SMOKE_ONLY === 'true';

async function readJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Expected JSON from ${response.url}, received: ${text.slice(0, 500)}`);
  }
}

async function api(body, options = {}) {
  const headers = {
    'content-type': 'application/json',
    origin,
    ...options.headers,
  };
  const response = await fetch(endpoint, {
    method: options.method ?? 'POST',
    headers,
    body: options.method === 'GET' ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
  });
  return { response, body: await readJson(response) };
}

async function waitForFunction() {
  let lastError;
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    try {
      const result = await api({ action: 'stats' }, { timeoutMs: 5_000 });
      if (result.response.ok) return result;
      lastError = new Error(`Function returned HTTP ${result.response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(2_000);
  }
  throw new Error(`Local Edge Function did not become ready: ${lastError?.message ?? 'unknown error'}`);
}

function logStep(message) {
  process.stdout.write(`✓ ${message}\n`);
}

async function runSmokeChecks() {
  const stats = await waitForFunction();
  assert.equal(stats.response.status, 200);
  assert.equal(stats.body.targetMs, 10_600);
  assert.ok(Array.isArray(stats.body.leaderboard));
  logStep('Edge Function is reachable through the local Supabase gateway');

  const methodResponse = await fetch(endpoint, {
    method: 'GET',
    headers: { origin },
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(methodResponse.status, 405);
  logStep('Unsupported HTTP methods are rejected');

  const forbiddenOrigin = await fetch(endpoint, {
    method: 'OPTIONS',
    headers: {
      origin: 'https://malicious.example',
      'access-control-request-method': 'POST',
    },
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(forbiddenOrigin.status, 403);
  logStep('CORS rejects untrusted origins');

  const reserved = await api({ action: 'access-status', nick: 'admin' });
  assert.equal(reserved.response.status, 400);
  assert.equal(reserved.body.code, 'nick_reserved');
  logStep('Nickname moderation runs inside the Edge Function');

  const injection = await api({ action: 'profile', nick: "ci' OR 1=1 --" });
  assert.notEqual(injection.response.status, 500);
  const statsAfterInjection = await api({ action: 'stats' });
  assert.equal(statsAfterInjection.response.status, 200);
  logStep('SQL-like input is handled as data and does not damage the database');
}

async function runGameJourney() {
  const suffix = Date.now().toString(36).slice(-8);
  const nick = `CIPlayer${suffix}`.slice(0, 24);
  const accountToken = randomBytes(32).toString('hex');
  const deviceId = `ci-device-${randomUUID()}`;
  const privateHeaders = {
    'x-account-token': accountToken,
    'x-device-id': deviceId,
  };

  const missingToken = await api({ action: 'account-players' });
  assert.equal(missingToken.response.status, 400);
  logStep('Private account endpoints require the account token');

  const started = await api({
    action: 'start',
    nick,
    team: 'spain',
  }, { headers: privateHeaders });
  assert.equal(started.response.status, 201, JSON.stringify(started.body));
  assert.match(String(started.body.challengeId), /^[0-9a-f-]{36}$/i);
  assert.ok(['press', 'release'].includes(started.body.interaction?.mode));
  assert.match(String(started.body.interaction?.nonce), /^[0-9a-f-]{36}$/i);
  logStep('A player account and server-side game challenge can be created');

  const accountPlayers = await api({ action: 'account-players' }, { headers: privateHeaders });
  assert.equal(accountPlayers.response.status, 200, JSON.stringify(accountPlayers.body));
  assert.match(JSON.stringify(accountPlayers.body), new RegExp(nick, 'i'));
  logStep('The created nickname is linked to the anonymous account');

  await delay(10_600);
  const interaction = started.body.interaction;
  const finished = await api({
    action: 'finish',
    challengeId: started.body.challengeId,
    clientElapsedMs: 10_600,
    clientSignals: {
      trustedStart: true,
      trustedFinish: true,
      timerConcealed: true,
      visibilityChanges: 0,
      focusLosses: 0,
      interactionMode: interaction.mode,
      controlNonce: interaction.nonce,
      finishEvent: 'keydown',
      pointerTrusted: true,
      userActivation: true,
      automationDetected: false,
      pointerType: 'keyboard',
      pointerXPercent: -1,
      pointerYPercent: -1,
      pointerMoveCount: 0,
      pointerTravelPx: 0,
      pointerDwellMs: 0,
      pressureMax: 0,
      holdDurationMs: 0,
      samePointer: true,
      keyboardKey: interaction.keyboardKey,
    },
  }, { headers: privateHeaders, timeoutMs: 20_000 });
  assert.equal(finished.response.status, 201, JSON.stringify(finished.body));
  assert.equal(finished.body.attempt?.verified, true, JSON.stringify(finished.body));
  assert.equal(finished.body.attempt?.differenceMs, 0);
  assert.equal(finished.body.profile?.verifiedAttempts, 1);
  logStep('A full timed attempt is persisted and verified through PostgreSQL RPCs');

  const duel = await api({ action: 'create-duel', nick }, { headers: privateHeaders });
  assert.equal(duel.response.status, 201, JSON.stringify(duel.body));
  assert.match(String(duel.body.code), /^[0-9a-f-]{36}$/i);
  logStep('A verified player can create a direct challenge');

  const league = await api({
    action: 'create-league',
    nick,
    name: `CI League ${suffix}`,
  }, { headers: privateHeaders });
  assert.equal(league.response.status, 201, JSON.stringify(league.body));
  assert.match(String(league.body.code), /^[A-Z0-9]{6}$/);

  const publicLeague = await api({ action: 'league', code: league.body.code });
  assert.equal(publicLeague.response.status, 200, JSON.stringify(publicLeague.body));
  logStep('Miniligas can be created and queried through the public API');

  const finalStats = await api({ action: 'stats' });
  assert.equal(finalStats.response.status, 200);
  assert.ok(Number(finalStats.body.totalAttempts) >= 1);
  assert.match(JSON.stringify(finalStats.body.leaderboard), new RegExp(nick, 'i'));
  logStep('Rankings and aggregate statistics include the verified attempt');
}

await runSmokeChecks();
if (!smokeOnly) await runGameJourney();

process.stdout.write(`Local Supabase integration suite completed (${smokeOnly ? 'smoke' : 'full'}).\n`);
