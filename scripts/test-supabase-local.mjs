import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const endpoint = process.env.SUPABASE_FUNCTION_URL
  ?? 'http://127.0.0.1:54321/functions/v1/game-api';
const leagueEndpoint = endpoint.replace(/\/game-api$/, '/league-api');
const playerContextEndpoint = endpoint.replace(/\/game-api$/, '/player-context');
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

async function requestApi(url, body, options = {}) {
  const headers = {
    'content-type': 'application/json',
    origin,
    ...options.headers,
  };
  const response = await fetch(url, {
    method: options.method ?? 'POST',
    headers,
    body: options.method === 'GET' ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
  });
  return { response, body: await readJson(response) };
}

function api(body, options = {}) {
  return requestApi(endpoint, body, options);
}

function leagueApi(body, options = {}) {
  return requestApi(leagueEndpoint, body, options);
}

async function playerContext(nick, options = {}) {
  return requestApi(playerContextEndpoint, { action: 'player-context', nick }, options);
}

async function waitForFunctions() {
  let lastError;
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    try {
      const [game, leagues] = await Promise.all([
        api({ action: 'stats' }, { timeoutMs: 5_000 }),
        leagueApi({ action: 'list-leagues', visibility: 'all', search: '' }, { timeoutMs: 5_000 }),
      ]);
      if (game.response.ok && leagues.response.ok) return game;
      lastError = new Error(`Functions returned HTTP ${game.response.status}/${leagues.response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(2_000);
  }
  throw new Error(`Local Edge Functions did not become ready: ${lastError?.message ?? 'unknown error'}`);
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

function accountHeaders(accountToken, deviceId) {
  return {
    'x-account-token': accountToken,
    'x-device-id': deviceId,
  };
}

async function joinLeague({ accountToken, code, deviceId, nick, publicId }) {
  return leagueApi({ action: 'join-league', nick, code, publicId }, {
    headers: accountHeaders(accountToken, deviceId),
  });
}

async function runSmokeChecks() {
  const stats = await waitForFunctions();
  assert.equal(stats.response.status, 200);
  assertGatewayAllowsOrigin(stats.response);
  assert.equal(stats.body.targetMs, 10_600);
  assert.ok(Array.isArray(stats.body.leaderboard));
  logStep('Game and league Edge Functions are reachable from a configured browser origin');

  for (const url of [endpoint, leagueEndpoint]) {
    const preflight = await fetch(url, {
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
    assert.match(preflight.headers.get('access-control-allow-headers') ?? '', /x-account-token/i);
  }
  logStep('Supabase gateway returns successful browser preflights for both domain endpoints');

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
  const privateHeaders = accountHeaders(accountToken, deviceId);

  const availableContext = await playerContext(nick);
  assert.equal(availableContext.response.status, 200, JSON.stringify(availableContext.body));
  assert.equal(availableContext.body.availability, 'available');
  assert.equal(availableContext.body.profile, null);
  assert.deepEqual(availableContext.body.leagues, []);
  logStep('Typing an unused nickname reports availability without creating an account');

  const missingToken = await api({ action: 'account-players' });
  assert.equal(missingToken.response.status, 400);
  logStep('Private account endpoints require the account token');

  const missingHumanProof = await api({ action: 'start', nick, team: 'spain' }, { headers: privateHeaders });
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

  const ownedContext = await playerContext(nick, { headers: privateHeaders });
  assert.equal(ownedContext.response.status, 200, JSON.stringify(ownedContext.body));
  assert.equal(ownedContext.body.availability, 'owned');
  assert.equal(ownedContext.body.profile?.nick, nick);
  assert.deepEqual(ownedContext.body.leagues, []);
  const occupiedContext = await playerContext(nick);
  assert.equal(occupiedContext.body.availability, 'occupied');
  assert.deepEqual(occupiedContext.body.leagues, []);
  logStep('The debounced player context distinguishes owned and occupied nicknames');

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

  const league = await leagueApi({
    action: 'create-league',
    nick,
    name: `CI League ${suffix}`,
    visibility: 'public',
    durationDays: 1,
    maxParticipants: 10,
  }, { headers: privateHeaders });
  assert.equal(league.response.status, 201, JSON.stringify(league.body));
  assert.match(String(league.body.publicId), /^[A-Z0-9]{6}$/);
  assert.match(String(league.body.joinCode), /^[A-Z0-9]{6}$/);
  assert.notEqual(league.body.publicId, league.body.joinCode);
  assert.equal(league.body.visibility, 'public');
  assert.equal(league.body.durationDays, 1);
  assert.equal(league.body.maxParticipants, 10);
  assert.equal(league.body.waiting, true);
  assert.equal(league.body.active, false);

  const joinedLeaguesBefore = await leagueApi({ action: 'player-leagues', nick }, { headers: privateHeaders });
  assert.equal(joinedLeaguesBefore.response.status, 200, JSON.stringify(joinedLeaguesBefore.body));
  assert.equal(joinedLeaguesBefore.body[0]?.publicId, league.body.publicId);
  assert.equal(joinedLeaguesBefore.body[0]?.competitionCode, league.body.publicId);
  assert.equal(joinedLeaguesBefore.body[0]?.joinCode, league.body.joinCode);
  assert.equal(joinedLeaguesBefore.body[0]?.attemptsUsed, 0);
  assert.equal(joinedLeaguesBefore.body[0]?.attemptsLeft, 5);
  assert.equal(joinedLeaguesBefore.body[0]?.waiting, true);
  logStep('A new public league exposes bounded settings and an owner-only private invitation key');

  const directory = await leagueApi({ action: 'list-leagues', search: suffix, visibility: 'public' });
  assert.equal(directory.response.status, 200, JSON.stringify(directory.body));
  assert.equal(directory.body[0]?.publicId, league.body.publicId);
  assert.equal(directory.body[0]?.locked, false);
  assert.equal('joinCode' in (directory.body[0] ?? {}), false);
  assert.doesNotMatch(JSON.stringify(directory.body), new RegExp(league.body.joinCode));
  logStep('The public directory lists joinable metadata without exposing private credentials');

  const blockedWaitingStart = await startAttempt({ nick, team: 'argentina', leagueCode: league.body.publicId }, privateHeaders);
  assert.notEqual(blockedWaitingStart.response.status, 201, JSON.stringify(blockedWaitingStart.body));
  assert.equal(blockedWaitingStart.body.challengeId, undefined);
  assert.equal(blockedWaitingStart.body.waiting, true);
  logStep('A waiting league cannot create a challenge');

  const aliasJoin = await joinLeague({
    accountToken,
    publicId: league.body.publicId,
    deviceId: `ci-device-${randomUUID()}`,
    nick: `CIAlias${suffix}`.slice(0, 24),
  });
  assert.equal(aliasJoin.response.status, 409, JSON.stringify(aliasJoin.body));
  assert.equal(aliasJoin.body.code, 'league_identity_limit');
  logStep('A second nickname from the same account cannot occupy another place in the league');

  const sameDeviceJoin = await joinLeague({
    accountToken: randomBytes(32).toString('hex'),
    publicId: league.body.publicId,
    deviceId,
    nick: `CISameDev${suffix}`.slice(0, 24),
  });
  assert.equal(sameDeviceJoin.response.status, 409, JSON.stringify(sameDeviceJoin.body));
  assert.equal(sameDeviceJoin.body.code, 'league_identity_limit');
  logStep('A different account on an already represented device cannot occupy another place');

  const secondJoin = await joinLeague({
    accountToken: randomBytes(32).toString('hex'),
    publicId: league.body.publicId,
    deviceId: `ci-device-${randomUUID()}`,
    nick: `CISecond${suffix}`.slice(0, 24),
  });
  assert.equal(secondJoin.response.status, 200, JSON.stringify(secondJoin.body));
  assert.equal(secondJoin.body.waiting, true);
  assert.equal(secondJoin.body.eligibleOwners, 2);
  assert.equal(secondJoin.body.eligibleDevices, 2);

  const eligibleJoin = await joinLeague({
    accountToken: randomBytes(32).toString('hex'),
    publicId: league.body.publicId,
    deviceId: `ci-device-${randomUUID()}`,
    nick: `CIEligible${suffix}`.slice(0, 24),
  });
  assert.equal(eligibleJoin.response.status, 200, JSON.stringify(eligibleJoin.body));
  assert.equal(eligibleJoin.body.active, false);
  assert.equal(eligibleJoin.body.waiting, false);
  assert.equal(eligibleJoin.body.scheduled, true);
  const startsAt = new Date(eligibleJoin.body.startsAt).getTime();
  const endsAt = new Date(eligibleJoin.body.endsAt).getTime();
  const scheduleDelay = startsAt - Date.now();
  assert.ok(scheduleDelay > 22.9 * 3_600_000 && scheduleDelay <= 23 * 3_600_000);
  assert.equal(endsAt - startsAt, 86_400_000);
  logStep('The third distinct account/device schedules the selected one-day league exactly 23 hours ahead');

  const blockedScheduledStart = await startAttempt({ nick, team: 'argentina', leagueCode: league.body.publicId }, privateHeaders);
  assert.notEqual(blockedScheduledStart.response.status, 201, JSON.stringify(blockedScheduledStart.body));
  assert.equal(blockedScheduledStart.body.challengeId, undefined);
  assert.equal(blockedScheduledStart.body.scheduled, true);
  assert.ok(blockedScheduledStart.body.countdownSeconds > 82_000);
  logStep('A scheduled league rejects attempt reservations until its server start time');

  const publicLeague = await leagueApi({ action: 'league', publicId: league.body.publicId });
  assert.equal(publicLeague.response.status, 200, JSON.stringify(publicLeague.body));
  assert.equal(publicLeague.body.publicId, league.body.publicId);
  assert.equal(publicLeague.body.scheduled, true);
  assert.equal(publicLeague.body.totalAttempts, 0);
  assert.equal(publicLeague.body.durationDays, 1);
  assert.equal(publicLeague.body.maxParticipants, 10);
  assert.equal('joinCode' in publicLeague.body, false);
  assert.doesNotMatch(JSON.stringify(publicLeague.body), new RegExp(league.body.joinCode));

  const leagueStatus = await leagueApi({
    action: 'league-status',
    nick,
    publicId: league.body.publicId,
  }, { headers: privateHeaders });
  assert.equal(leagueStatus.response.status, 200, JSON.stringify(leagueStatus.body));
  assert.equal(leagueStatus.body.publicId, league.body.publicId);
  assert.equal(leagueStatus.body.scheduled, true);
  assert.equal(leagueStatus.body.attemptsUsed, 0);
  assert.equal(leagueStatus.body.attemptsLeft, 5);
  assert.doesNotMatch(JSON.stringify(leagueStatus.body), new RegExp(league.body.joinCode));
  logStep('Protected membership status exposes its isolated budget without leaking the invitation key');

  const contextAfterLeague = await playerContext(nick, { headers: privateHeaders });
  assert.equal(contextAfterLeague.body.availability, 'owned');
  assert.equal(contextAfterLeague.body.leagues?.[0]?.publicId, league.body.publicId);
  assert.equal(contextAfterLeague.body.leagues?.[0]?.competitionCode, league.body.publicId);
  assert.equal(contextAfterLeague.body.leagues?.[0]?.joinCode, league.body.joinCode);
  assert.equal(contextAfterLeague.body.leagues?.[0]?.scheduled, true);
  logStep('One player-context request returns profile, availability and the scheduled competition');

  const finalStats = await api({ action: 'stats' });
  assert.equal(finalStats.response.status, 200);
  assert.equal(finalStats.body.totalAttempts, 1);
  assert.equal(finalStats.body.verifiedAttempts, 1);
  assert.match(JSON.stringify(finalStats.body.leaderboard), new RegExp(nick, 'i'));

  const globalProfile = await api({ action: 'profile', nick });
  assert.equal(globalProfile.body.attemptsUsed, 1);
  assert.equal(globalProfile.body.verifiedAttempts, 1);
  assert.equal(globalProfile.body.history?.length, 1);
  assert.ok(Number(globalProfile.body.profileRevision) > 0);
  logStep('Scheduled leagues never consume global attempts or enter global statistics and profiles');
}

await runSmokeChecks();
if (!smokeOnly) await runGameJourney();

process.stdout.write(`Local Supabase integration suite completed (${smokeOnly ? 'smoke' : 'full'}).\n`);
