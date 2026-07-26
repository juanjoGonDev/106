import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';

const endpoint = process.env.SUPABASE_FUNCTION_URL
  ?? 'http://127.0.0.1:54321/functions/v1/game-api';
const origin = 'http://127.0.0.1:3000';
const TARGET_ELAPSED_MS = 10_600;

async function readJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Expected JSON from ${response.url}, received: ${text.slice(0, 500)}`);
  }
}

async function api(body, headers, timeoutMs = 15_000) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin,
      ...headers,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { response, body: await readJson(response) };
}

async function waitForFunction() {
  let lastError;
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    try {
      const result = await api({ action: 'stats' }, {} , 5_000);
      if (result.response.ok) return;
      lastError = new Error(`Function returned HTTP ${result.response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(2_000);
  }
  throw new Error(`Local Edge Function did not become ready: ${lastError?.message ?? 'unknown error'}`);
}

async function createHumanProof(headers) {
  const created = await api({ action: 'human-check' }, headers);
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
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
  }, headers);
  assert.equal(completed.response.status, 201, JSON.stringify(completed.body));
  return {
    humanCheckId: completed.body.checkId,
    humanProofToken: completed.body.proofToken,
  };
}

async function startAttempt({ nick, team, proof }, headers) {
  return api({ action: 'start', nick, team, ...proof }, headers);
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

function assertAttemptLimit(result) {
  assert.equal(result.response.status, 409, JSON.stringify(result.body));
  assert.equal(result.body.attemptsLeft, 0, JSON.stringify(result.body));
  assert.match(String(result.body.error), /intentos disponibles|agotado/i);
}

await waitForFunction();

const suffix = Date.now().toString(36).slice(-8);
const nick = `CIReserve${suffix}`.slice(0, 24);
const headers = {
  'x-account-token': randomBytes(32).toString('hex'),
  'x-device-id': `ci-device-${randomUUID()}`,
};

const firstProof = await createHumanProof(headers);
const first = await startAttempt({ nick, team: 'spain', proof: firstProof }, headers);
assert.equal(first.response.status, 201, JSON.stringify(first.body));
const firstStartedAt = performance.now();

const additionalProofs = [];
for (let index = 0; index < 4; index += 1) {
  additionalProofs.push(await createHumanProof(headers));
}
const additional = await Promise.all(additionalProofs.map((proof, index) => startAttempt({
  nick,
  team: index % 2 === 0 ? 'argentina' : 'spain',
  proof,
}, headers)));

for (const result of additional) {
  assert.equal(result.response.status, 201, JSON.stringify(result.body));
}
const activeChallenges = [first, ...additional];
assert.equal(new Set(activeChallenges.map((result) => result.body.challengeId)).size, 5);
assert.deepEqual(
  activeChallenges.map((result) => result.body.attemptsLeft).sort((left, right) => left - right),
  [0, 1, 2, 3, 4],
);
process.stdout.write('✓ Five concurrent tabs reserve the five available global attempts\n');

const blockedProof = await createHumanProof(headers);
const blocked = await startAttempt({ nick, team: 'spain', proof: blockedProof }, headers);
assertAttemptLimit(blocked);
process.stdout.write('✓ A sixth prepared tab is rejected by the server-side budget\n');

const elapsedBeforeWait = performance.now() - firstStartedAt;
if (elapsedBeforeWait < TARGET_ELAPSED_MS) {
  await delay(TARGET_ELAPSED_MS - elapsedBeforeWait);
}
const clientElapsedMs = Math.round(performance.now() - firstStartedAt);
const finished = await api({
  action: 'finish',
  challengeId: first.body.challengeId,
  clientElapsedMs,
  clientSignals: validFinishSignals(first.body.interaction),
}, headers, 20_000);
assert.equal(finished.response.status, 201, JSON.stringify(finished.body));
assert.equal(finished.body.attempt?.verified, true, JSON.stringify(finished.body));
assert.equal(finished.body.profile?.attemptsUsed, 1, JSON.stringify(finished.body));
assert.ok(finished.body.stats?.awards && typeof finished.body.stats.awards === 'object', JSON.stringify(finished.body));
assert.ok(finished.body.stats.awards.goldenBoot?.nick, JSON.stringify(finished.body.stats.awards));
process.stdout.write('✓ Finish returns one complete statistics snapshot with daily awards\n');

const stillBlockedProof = await createHumanProof(headers);
const stillBlocked = await startAttempt({ nick, team: 'argentina', proof: stillBlockedProof }, headers);
assertAttemptLimit(stillBlocked);
process.stdout.write('✓ Persisted attempts plus remaining active tabs continue to consume the same budget\n');

const stats = await api({ action: 'stats' }, headers);
assert.equal(stats.response.status, 200, JSON.stringify(stats.body));
assert.deepEqual(finished.body.stats.awards, stats.body.awards);
process.stdout.write('Local concurrent-attempt reservation suite completed.\n');
