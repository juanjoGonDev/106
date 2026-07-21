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

function validFinishSignals(interaction) {
  return {
    trustedStart: true,
    trustedFinish: true,
    timerConcealed: true,
    visibilityChanges: 0,
    focusLosses: 0,
    interactionMode: 'press',
    controlNonce: interaction.nonce,
    finishEvent: 'pointerdown',
    pointerTrusted: true,
    userActivation: true,
    automationDetected: false,
    pointerType: 'mouse',
    pointerXPercent: interaction.xPercent,
    pointerYPercent: interaction.yPercent,
    pointerMoveCount: 4,
    pointerTravelPx: 72,
    pointerDwellMs: 420,
    pressureMax: 0.5,
    holdDurationMs: 0,
    samePointer: true,
  };
}

async function createHumanProof(headers) {
  const created = await api({ action: 'human-check' }, { headers });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  assert.match(String(created.body.checkId), /^[0-9a-f-]{36}$/i);
  assert.equal(created.body.balls?.length, 4);

  const clicks = created.body.balls.map((ball, index) => ({
    x: ball.x,
    y: ball.y,
    atMs: 240 + index * 310,
    pointerType: 'mouse',
    trusted: true,
  }));
  const completed = await api({
    action: 'complete-human-check',
    checkId: created.body.checkId,
    clicks,
  }, { headers });
  assert.equal(completed.response.status, 201, JSON.stringify(completed.body));
  assert.match(String(completed.body.proofToken), /^[a-f0-9]{64}$/i);
  return {
    humanCheckId: completed.body.checkId,
    humanProofToken: completed.body.proofToken,
  };
}

async function startAttempt(payload, headers) {
  const proof = await createHumanProof(headers);
  return api({ action: 'start', ...payload, ...proof }, { headers });
}

async function completeAttempt(started, headers) {
  await delay(10_600);
  return api({
    action: 'finish',
    challengeId: started.body.challengeId,
    clientElapsedMs: 10_600,
    clientSignals: validFinishSignals(started.body.interaction),
  }, { headers, timeoutMs: 20_000 });
}

function assertGatewayAllowsOrigin(response) {
  const allowedOrigin = response.headers.get('access-control-allow-origin');
  assert.ok(allowedOrigin === origin || allowedOrigin === '*', `Unexpected allow-origin: ${allowedOrigin}`);
}

async function runSmokeChecks() {
  const stats = await waitForFunction();
  assert.equal(stats.response.status, 200);
  assertGatewayAllowsOrigin(stats.response);
  assert.equal(stats.body.targetMs, 10_600);
  assert.ok(Array.isArray(stats.body.leaderboard));
  logStep('Edge Function is reachable from a configured browser origin');

  const preflight = await fetch(endpoint, {
    method: 'OPTIONS',
    headers: {
      origin,
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type,x-device-id,x-account-token',
    },
    signal: AbortSignal.timeout(10_000),
  });
  assert.ok(preflight.status >= 200 && preflight.status < 300, `Unexpected preflight status ${preflight.status}`);
  assertGatewayAllowsOrigin(preflight);
  assert.match(
    preflight.headers.get('access-control-allow-headers') ?? '',
    /x-account-token/i,
  );
  logStep('Supabase gateway returns a successful browser preflight');

  const methodResponse = await fetch(endpoint, {
    method: 'GET',
    headers: { origin },
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(methodResponse.status, 405);
  logStep('Unsupported HTTP methods are rejected');

  const forbiddenOrigin = await api(
    { action: 'stats' },
    { headers: { origin: 'https://malicious.example' } },
  );
  assert.equal(forbiddenOrigin.response.status, 403);
  logStep('CORS rejects untrusted origins on requests handled by the Edge Function');

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

  const missingHumanProof = await api({
    action: 'start',
    nick,
    team: 'spain',
  }, { headers: privateHeaders });
  assert.equal(missingHumanProof.response.status, 400);
  assert.match(String(missingHumanProof.body.error), /verificación visual/i);
  logStep('Starting an attempt requires a completed one-time visual verification');

  const started = await startAttempt({ nick, team: 'spain' }, privateHeaders);
  assert.equal(started.response.status, 201, JSON.stringify(started.body));
  assert.match(String(started.body.challengeId), /^[0-9a-f-]{36}$/i);
  assert.equal(started.body.competition?.type, 'global');
  assert.equal(started.body.interaction?.mode, 'press');
  assert.equal('keyboardKey' in (started.body.interaction ?? {}), false);
  assert.match(String(started.body.interaction?.nonce), /^[0-9a-f-]{36}$/i);
  logStep('A player account and pointer-only global challenge can be created');

  const accountPlayers = await api({ action: 'account-players' }, { headers: privateHeaders });
  assert.equal(accountPlayers.response.status, 200, JSON.stringify(accountPlayers.body));
  assert.match(JSON.stringify(accountPlayers.body), new RegExp(nick, 'i'));
  logStep('The created nickname is linked to the anonymous account');

  const finished = await completeAttempt(started, privateHeaders);
  assert.equal(finished.response.status, 201, JSON.stringify(finished.body));
  assert.equal(finished.body.attempt?.verified, true, JSON.stringify(finished.body));
  assert.equal(finished.body.attempt?.differenceMs, 0);
  assert.equal(finished.body.attempt?.competitionType, 'global');
  assert.equal(finished.body.profile?.verifiedAttempts, 1);
  logStep('A full pointer-only global attempt is persisted and verified through PostgreSQL RPCs');

  const duel = await api({ action: 'create-duel', nick }, { headers: privateHeaders });
  assert.equal(duel.response.status, 201, JSON.stringify(duel.body));
  assert.match(String(duel.body.code), /^[0-9a-f-]{36}$/i);
  logStep('A verified global player can create a direct challenge');

  const league = await api({
    action: 'create-league',
    nick,
    name: `CI League ${suffix}`,
  }, { headers: privateHeaders });
  assert.equal(league.response.status, 201, JSON.stringify(league.body));
  assert.match(String(league.body.code), /^[A-Z0-9]{6}$/);

  const joinedLeaguesBefore = await api({ action: 'player-leagues', nick }, { headers: privateHeaders });
  assert.equal(joinedLeaguesBefore.response.status, 200, JSON.stringify(joinedLeaguesBefore.body));
  assert.equal(joinedLeaguesBefore.body[0]?.attemptsUsed, 0);
  assert.equal(joinedLeaguesBefore.body[0]?.attemptsLeft, 5);
  logStep('The owner sees the newly created league in their private league list');

  const leagueStarted = await startAttempt({
    nick,
    team: 'argentina',
    leagueCode: league.body.code,
  }, privateHeaders);
  assert.equal(leagueStarted.response.status, 201, JSON.stringify(leagueStarted.body));
  assert.equal(leagueStarted.body.competition?.type, 'league');
  assert.equal(leagueStarted.body.competition?.code, league.body.code);
  assert.equal(leagueStarted.body.interaction?.mode, 'press');

  const leagueFinished = await completeAttempt(leagueStarted, privateHeaders);
  assert.equal(leagueFinished.response.status, 201, JSON.stringify(leagueFinished.body));
  assert.equal(leagueFinished.body.attempt?.verified, true, JSON.stringify(leagueFinished.body));
  assert.equal(leagueFinished.body.attempt?.competitionType, 'league');
  assert.equal(leagueFinished.body.attempt?.leagueCode, league.body.code);
  logStep('A league attempt is persisted with an explicit league scope');

  const publicLeague = await api({ action: 'league', code: league.body.code });
  assert.equal(publicLeague.response.status, 200, JSON.stringify(publicLeague.body));
  assert.equal(publicLeague.body.totalAttempts, 1);
  assert.match(JSON.stringify(publicLeague.body.leaderboard), new RegExp(nick, 'i'));

  const leagueStatus = await api({ action: 'league-status', nick, code: league.body.code }, { headers: privateHeaders });
  assert.equal(leagueStatus.response.status, 200, JSON.stringify(leagueStatus.body));
  assert.equal(leagueStatus.body.attemptsUsed, 1);
  assert.equal(leagueStatus.body.attemptsLeft, 4);
  assert.equal(leagueStatus.body.history?.[0]?.differenceMs, 0);
  logStep('League membership exposes its own attempt budget, rank and history');

  const finalStats = await api({ action: 'stats' });
  assert.equal(finalStats.response.status, 200);
  assert.equal(finalStats.body.totalAttempts, 1);
  assert.equal(finalStats.body.verifiedAttempts, 1);
  assert.match(JSON.stringify(finalStats.body.leaderboard), new RegExp(nick, 'i'));

  const globalProfile = await api({ action: 'profile', nick });
  assert.equal(globalProfile.body.attemptsUsed, 1);
  assert.equal(globalProfile.body.verifiedAttempts, 1);
  assert.equal(globalProfile.body.history?.length, 1);
  logStep('League attempts never consume global attempts or enter global statistics and profiles');
}

await runSmokeChecks();
if (!smokeOnly) await runGameJourney();

process.stdout.write(`Local Supabase integration suite completed (${smokeOnly ? 'smoke' : 'full'}).\n`);
