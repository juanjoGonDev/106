import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const gameEndpoint = process.env.SUPABASE_FUNCTION_URL
  ?? 'http://127.0.0.1:54321/functions/v1/game-api';
const readyEndpoint = gameEndpoint.replace(/\/[^/]+$/, '/game-ready-api');
const origin = 'http://127.0.0.1:3000';
const localTestToken = process.env.LOCAL_E2E_TEST_TOKEN ?? 'ci-local-ranked-anti-cheat-106';
const countdownMs = 3_000;
const elapsedMs = 2_300;

async function readJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Expected JSON from ${response.url}, received: ${text.slice(0, 500)}`);
  }
}

async function api(endpoint, body, headers = {}, requestOrigin = origin) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: requestOrigin,
      ...headers,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  return { response, body: await readJson(response) };
}

function createHeaders(prefix) {
  return {
    'x-account-token': randomBytes(32).toString('hex'),
    'x-device-id': `${prefix}-${randomUUID()}`,
  };
}

function token(label) {
  return `test-valid:${label}-${randomBytes(8).toString('hex')}`;
}

function clicksFor(balls, options = {}) {
  return balls.map((ball, index) => ({
    x: Number(ball.x) + Number(options.offsetX ?? 0),
    y: Number(ball.y) + Number(options.offsetY ?? 0),
    atMs: 240 + index * 320,
    pointerType: options.pointerType ?? 'touch',
    trusted: options.trusted ?? false,
  }));
}

async function createCheck(headers) {
  const check = await api(readyEndpoint, { action: 'human-check' }, headers);
  assert.equal(check.response.status, 201, JSON.stringify(check.body));
  assert.match(String(check.body.checkId), /^[0-9a-f-]{36}$/i);
  assert.equal(check.body.image?.mediaType, 'image/png');
  assert.match(String(check.body.image?.dataUrl), /^data:image\/png;base64,/);
  assert.match(String(check.body.image?.digest), /^[a-f0-9]{64}$/);
  assert.ok(Number(check.body.image?.width) >= 320);
  assert.ok(Number(check.body.image?.height) >= 200);
  assert.equal('balls' in check.body, false, JSON.stringify(check.body));
  assert.doesNotMatch(JSON.stringify(check.body), /"(?:x|y|radius|order)"\s*:/);
  return check.body;
}

async function readSolution(checkId, headers, testToken = localTestToken) {
  return api(readyEndpoint, {
    action: 'test-human-check-solution',
    checkId,
  }, {
    ...headers,
    'x-test-run-token': testToken,
  });
}

async function completeCheck(check, headers, clickOptions = {}) {
  const solution = await readSolution(check.checkId, headers);
  assert.equal(solution.response.status, 200, JSON.stringify(solution.body));
  assert.equal(solution.body.balls?.length, 4, JSON.stringify(solution.body));
  return api(readyEndpoint, {
    action: 'complete-human-check',
    checkId: check.checkId,
    clicks: clicksFor(solution.body.balls, clickOptions),
  }, headers);
}

async function createProof(headers) {
  const check = await createCheck(headers);
  const completed = await completeCheck(check, headers);
  assert.equal(completed.response.status, 201, JSON.stringify(completed.body));
  assert.match(String(completed.body.proofToken), /^[a-f0-9]{64}$/);
  return completed.body;
}

async function prepareAttempt({ nick, team, headers, turnstileToken }) {
  const proof = await createProof(headers);
  const prepared = await api(readyEndpoint, {
    action: 'prepare-start',
    nick,
    team,
    humanCheckId: proof.checkId,
    humanProofToken: proof.proofToken,
    turnstileToken,
  }, headers);
  return { proof, prepared };
}

async function activateAttempt(prepared, headers) {
  const activationRequestedAt = Date.now();
  const activated = await api(readyEndpoint, {
    action: 'activate-start',
    challengeId: prepared.body.challengeId,
    countdownMs,
  }, headers);
  assert.equal(activated.response.status, 200, JSON.stringify(activated.body));
  const startsAt = Date.parse(activated.body.startsAt);
  assert.ok(startsAt - activationRequestedAt >= 2_800, `Countdown lead too short: ${startsAt - activationRequestedAt}`);
  assert.ok(startsAt - activationRequestedAt <= 3_600, `Countdown lead too long: ${startsAt - activationRequestedAt}`);
  return { activated, startsAt };
}

function fabricatedSignals(interaction, overrides = {}) {
  return {
    trustedStart: false,
    trustedFinish: false,
    timerConcealed: false,
    visibilityChanges: 20,
    focusLosses: 20,
    interactionMode: 'forged',
    controlNonce: randomUUID(),
    finishEvent: 'keydown',
    pointerTrusted: false,
    userActivation: false,
    automationDetected: true,
    pointerType: 'mouse',
    pointerXPercent: -1,
    pointerYPercent: 101,
    pointerMoveCount: 0,
    pointerTravelPx: 0,
    pointerDwellMs: 0,
    pressureMax: 0,
    holdDurationMs: 0,
    samePointer: false,
    interaction,
    ...overrides,
  };
}

const suffix = Date.now().toString(36).slice(-8);

const health = await api(readyEndpoint, { action: 'health' });
assert.equal(health.response.status, 200, JSON.stringify(health.body));
assert.deepEqual(health.body, {
  ok: true,
  contract: 'ranked-anti-cheat-v2',
  challengeFormat: 'raster-png-v1',
  turnstileRequired: true,
});
process.stdout.write('✓ Readiness publishes the raster and strict Turnstile contract.\n');

const rasterHeaders = createHeaders('ci-raster');
const firstCheck = await createCheck(rasterHeaders);
const unprivilegedSolution = await readSolution(firstCheck.checkId, rasterHeaders, 'wrong-test-token-value');
assert.equal(unprivilegedSolution.response.status, 403, JSON.stringify(unprivilegedSolution.body));
const remoteSolution = await api(readyEndpoint, {
  action: 'test-human-check-solution',
  checkId: firstCheck.checkId,
}, {
  ...rasterHeaders,
  'x-test-run-token': localTestToken,
}, 'https://juanjogondev.github.io');
assert.equal(remoteSolution.response.status, 403, JSON.stringify(remoteSolution.body));
process.stdout.write('✓ The deterministic solution endpoint requires local origin and an explicit test token.\n');

const wrongSolution = await readSolution(firstCheck.checkId, rasterHeaders);
assert.equal(wrongSolution.response.status, 200, JSON.stringify(wrongSolution.body));
const wrongCompletion = await api(readyEndpoint, {
  action: 'complete-human-check',
  checkId: firstCheck.checkId,
  clicks: clicksFor(wrongSolution.body.balls, { offsetX: 30, offsetY: 30, trusted: true }),
}, rasterHeaders);
assert.equal(wrongCompletion.response.status, 400, JSON.stringify(wrongCompletion.body));

const replacementCheck = await createCheck(rasterHeaders);
assert.notEqual(replacementCheck.checkId, firstCheck.checkId);
assert.notEqual(replacementCheck.image.digest, firstCheck.image.digest);
process.stdout.write('✓ Incorrect input is rejected and a replacement raster has a new ID and digest.\n');

const concurrencyHeaders = createHeaders('ci-check-race');
const concurrencyCheck = await createCheck(concurrencyHeaders);
const concurrencySolution = await readSolution(concurrencyCheck.checkId, concurrencyHeaders);
const completionPayload = {
  action: 'complete-human-check',
  checkId: concurrencyCheck.checkId,
  clicks: clicksFor(concurrencySolution.body.balls, { trusted: true }),
};
const concurrentCompletions = await Promise.all([
  api(readyEndpoint, completionPayload, concurrencyHeaders),
  api(readyEndpoint, completionPayload, concurrencyHeaders),
]);
assert.deepEqual(
  concurrentCompletions.map((result) => result.response.status).sort((left, right) => left - right),
  [201, 409],
  JSON.stringify(concurrentCompletions.map((result) => result.body)),
);
process.stdout.write('✓ Concurrent human-check completion succeeds exactly once.\n');

const missingTurnstileHeaders = createHeaders('ci-turnstile');
const missingProof = await createProof(missingTurnstileHeaders);
const missingTurnstile = await api(readyEndpoint, {
  action: 'prepare-start',
  nick: `CIMissing${suffix}`.slice(0, 24),
  team: 'spain',
  humanCheckId: missingProof.checkId,
  humanProofToken: missingProof.proofToken,
}, missingTurnstileHeaders);
assert.equal(missingTurnstile.response.status, 400, JSON.stringify(missingTurnstile.body));
assert.equal(missingTurnstile.body.code, 'turnstile_invalid');

const reusableToken = token('replay');
const acceptedAfterMissing = await api(readyEndpoint, {
  action: 'prepare-start',
  nick: `CIMissing${suffix}`.slice(0, 24),
  team: 'spain',
  humanCheckId: missingProof.checkId,
  humanProofToken: missingProof.proofToken,
  turnstileToken: reusableToken,
}, missingTurnstileHeaders);
assert.equal(acceptedAfterMissing.response.status, 201, JSON.stringify(acceptedAfterMissing.body));

const replayProof = await createProof(missingTurnstileHeaders);
const replayedTurnstile = await api(readyEndpoint, {
  action: 'prepare-start',
  nick: `CIReplay${suffix}`.slice(0, 24),
  team: 'argentina',
  humanCheckId: replayProof.checkId,
  humanProofToken: replayProof.proofToken,
  turnstileToken: reusableToken,
}, missingTurnstileHeaders);
assert.equal(replayedTurnstile.response.status, 409, JSON.stringify(replayedTurnstile.body));
process.stdout.write('✓ Missing and replayed Turnstile proofs fail before consuming a valid human proof.\n');

const validHeaders = createHeaders('ci-ranked-valid');
const validAttempt = await prepareAttempt({
  nick: `CIValid${suffix}`.slice(0, 24),
  team: 'argentina',
  headers: validHeaders,
  turnstileToken: token('valid'),
});
assert.equal(validAttempt.prepared.response.status, 201, JSON.stringify(validAttempt.prepared.body));
const activation = await activateAttempt(validAttempt.prepared, validHeaders);
const activationReplay = await api(readyEndpoint, {
  action: 'activate-start',
  challengeId: validAttempt.prepared.body.challengeId,
  countdownMs,
}, validHeaders);
assert.equal(activationReplay.response.status, 409, JSON.stringify(activationReplay.body));
await delay(Math.max(0, activation.startsAt - Date.now()) + elapsedMs);
const validFinish = await api(gameEndpoint, {
  action: 'finish',
  challengeId: validAttempt.prepared.body.challengeId,
  clientElapsedMs: elapsedMs,
  clientSignals: fabricatedSignals(validAttempt.prepared.body.interaction),
}, validHeaders);
assert.equal(validFinish.response.status, 201, JSON.stringify(validFinish.body));
assert.equal(validFinish.body.attempt?.elapsedMs, elapsedMs);
assert.equal(validFinish.body.attempt?.verified, true, JSON.stringify(validFinish.body));
assert.ok(Math.abs(Number(validFinish.body.attempt?.transportDeltaMs)) < 500);
const finishReplay = await api(gameEndpoint, {
  action: 'finish',
  challengeId: validAttempt.prepared.body.challengeId,
  clientElapsedMs: elapsedMs,
  clientSignals: fabricatedSignals(validAttempt.prepared.body.interaction),
}, validHeaders);
assert.equal(finishReplay.response.status, 409, JSON.stringify(finishReplay.body));
process.stdout.write('✓ Client trust flags are telemetry only; server state, timing and one-use transitions are authoritative.\n');

const mismatchHeaders = createHeaders('ci-ranked-mismatch');
const mismatchAttempt = await prepareAttempt({
  nick: `CIMismatch${suffix}`.slice(0, 24),
  team: 'spain',
  headers: mismatchHeaders,
  turnstileToken: token('mismatch'),
});
assert.equal(mismatchAttempt.prepared.response.status, 201, JSON.stringify(mismatchAttempt.prepared.body));
const mismatchActivation = await activateAttempt(mismatchAttempt.prepared, mismatchHeaders);
await delay(Math.max(0, mismatchActivation.startsAt - Date.now()) + elapsedMs);
const mismatchedFinish = await api(gameEndpoint, {
  action: 'finish',
  challengeId: mismatchAttempt.prepared.body.challengeId,
  clientElapsedMs: 10_600,
  clientSignals: fabricatedSignals(mismatchAttempt.prepared.body.interaction),
}, mismatchHeaders);
assert.equal(mismatchedFinish.response.status, 400, JSON.stringify(mismatchedFinish.body));
assert.match(String(mismatchedFinish.body.error), /tiempo|coincide|válid/i);
const mismatchReplay = await api(gameEndpoint, {
  action: 'finish',
  challengeId: mismatchAttempt.prepared.body.challengeId,
  clientElapsedMs: elapsedMs,
  clientSignals: fabricatedSignals(mismatchAttempt.prepared.body.interaction),
}, mismatchHeaders);
assert.equal(mismatchReplay.response.status, 409, JSON.stringify(mismatchReplay.body));
process.stdout.write('✓ A fabricated perfect client time outside the server window is rejected and cannot be retried.\n');

const raceHeaders = createHeaders('ci-finish-race');
const raceAttempt = await prepareAttempt({
  nick: `CIRace${suffix}`.slice(0, 24),
  team: 'argentina',
  headers: raceHeaders,
  turnstileToken: token('finish-race'),
});
assert.equal(raceAttempt.prepared.response.status, 201, JSON.stringify(raceAttempt.prepared.body));
const raceActivation = await activateAttempt(raceAttempt.prepared, raceHeaders);
await delay(Math.max(0, raceActivation.startsAt - Date.now()) + elapsedMs);
const finishPayload = {
  action: 'finish',
  challengeId: raceAttempt.prepared.body.challengeId,
  clientElapsedMs: elapsedMs,
  clientSignals: fabricatedSignals(raceAttempt.prepared.body.interaction),
};
const finishRace = await Promise.all([
  api(gameEndpoint, finishPayload, raceHeaders),
  api(gameEndpoint, finishPayload, raceHeaders),
]);
assert.deepEqual(
  finishRace.map((result) => result.response.status).sort((left, right) => left - right),
  [201, 409],
  JSON.stringify(finishRace.map((result) => result.body)),
);
process.stdout.write('✓ Concurrent finish requests persist exactly one ranked attempt.\n');

process.stdout.write('Local ranked anti-cheat readiness suite completed.\n');
