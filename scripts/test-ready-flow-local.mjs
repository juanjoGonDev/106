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
    atMs: Number(options.startAtMs ?? 240) + index * 320,
    pointerType: options.pointerType ?? 'touch',
    trusted: options.trusted ?? false,
  }));
}

async function createCheck(headers) {
  const check = await api(readyEndpoint, { action: 'human-check' }, headers);
  assert.equal(check.response.status, 201, JSON.stringify(check.body));
  assert.match(String(check.body.checkId), /^[0-9a-f-]{36}$/i);
  assert.equal(check.body.selectedCount, 0);
  assert.equal(check.body.stateVersion, 0);
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

async function advanceCheck(check, headers, click) {
  return api(readyEndpoint, {
    action: 'human-check-click',
    checkId: check.checkId,
    click,
    stateVersion: check.stateVersion,
  }, headers);
}

async function completeCheck(check, headers, clickOptions = {}) {
  const solution = await readSolution(check.checkId, headers);
  assert.equal(solution.response.status, 200, JSON.stringify(solution.body));
  assert.equal(solution.body.balls?.length, 4, JSON.stringify(solution.body));
  const clicks = clicksFor(solution.body.balls, clickOptions);
  let current = check;

  for (let index = 0; index < clicks.length; index += 1) {
    const previousDigest = current.image.digest;
    const advanced = await advanceCheck(current, headers, clicks[index]);
    assert.equal(advanced.response.status, index === clicks.length - 1 ? 201 : 200, JSON.stringify(advanced.body));
    assert.equal(advanced.body.selectedCount, index + 1);
    assert.equal(advanced.body.stateVersion, index + 1);
    assert.notEqual(advanced.body.image?.digest, previousDigest);
    assert.equal('balls' in advanced.body, false, JSON.stringify(advanced.body));
    assert.doesNotMatch(JSON.stringify(advanced.body), /"(?:x|y|radius|order)"\s*:/);
    current = advanced.body;
  }

  return { response: { status: 201 }, body: current };
}

async function createProof(headers) {
  const check = await createCheck(headers);
  const completed = await completeCheck(check, headers);
  assert.equal(completed.response.status, 201, JSON.stringify(completed.body));
  assert.equal(completed.body.completed, true);
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
  contract: 'ranked-anti-cheat-v3',
  challengeFormat: 'raster-png-v1',
  progressiveHumanCheck: true,
  turnstileRequired: true,
});
process.stdout.write('✓ Readiness publishes the progressive raster and strict Turnstile contract.\n');

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
const wrongClick = clicksFor(wrongSolution.body.balls, { offsetX: 10, offsetY: 10, trusted: true })[0];
const wrongCompletion = await advanceCheck(firstCheck, rasterHeaders, wrongClick);
assert.equal(wrongCompletion.response.status, 400, JSON.stringify(wrongCompletion.body));
const wrongReplay = await advanceCheck(firstCheck, rasterHeaders, clicksFor(wrongSolution.body.balls)[0]);
assert.equal(wrongReplay.response.status, 409, JSON.stringify(wrongReplay.body));

const replacementCheck = await createCheck(rasterHeaders);
assert.notEqual(replacementCheck.checkId, firstCheck.checkId);
assert.notEqual(replacementCheck.image.digest, firstCheck.image.digest);
process.stdout.write('✓ Incorrect input invalidates the challenge and a replacement raster has a new ID and digest.\n');

const duplicateHeaders = createHeaders('ci-check-duplicate');
const duplicateCheck = await createCheck(duplicateHeaders);
const duplicateSolution = await readSolution(duplicateCheck.checkId, duplicateHeaders);
const duplicateClick = clicksFor(duplicateSolution.body.balls)[0];
const duplicatePayload = {
  action: 'human-check-click',
  checkId: duplicateCheck.checkId,
  click: duplicateClick,
  stateVersion: 0,
};
const duplicateResults = await Promise.all([
  api(readyEndpoint, duplicatePayload, duplicateHeaders),
  api(readyEndpoint, duplicatePayload, duplicateHeaders),
]);
assert.deepEqual(
  duplicateResults.map((result) => result.response.status).sort((left, right) => left - right),
  [200, 409],
  JSON.stringify(duplicateResults.map((result) => result.body)),
);

const differentHeaders = createHeaders('ci-check-different');
const differentCheck = await createCheck(differentHeaders);
const differentSolution = await readSolution(differentCheck.checkId, differentHeaders);
const firstBall = differentSolution.body.balls[0];
const differentPayloads = [
  { x: Number(firstBall.x), y: Number(firstBall.y), atMs: 240, pointerType: 'touch' },
  { x: Number(firstBall.x) + 0.25, y: Number(firstBall.y) + 0.25, atMs: 241, pointerType: 'touch' },
].map((click) => ({
  action: 'human-check-click',
  checkId: differentCheck.checkId,
  click,
  stateVersion: 0,
}));
const differentResults = await Promise.all(differentPayloads.map((payload) => (
  api(readyEndpoint, payload, differentHeaders)
)));
assert.deepEqual(
  differentResults.map((result) => result.response.status).sort((left, right) => left - right),
  [200, 409],
  JSON.stringify(differentResults.map((result) => result.body)),
);
process.stdout.write('✓ Duplicate and different concurrent presses advance exactly once.\n');

const completionHeaders = createHeaders('ci-check-complete-race');
const completionCheck = await createCheck(completionHeaders);
const completionSolution = await readSolution(completionCheck.checkId, completionHeaders);
const completionClicks = clicksFor(completionSolution.body.balls);
let completionState = completionCheck;
for (let index = 0; index < 3; index += 1) {
  const step = await advanceCheck(completionState, completionHeaders, completionClicks[index]);
  assert.equal(step.response.status, 200, JSON.stringify(step.body));
  completionState = step.body;
}
const finalPayload = {
  action: 'human-check-click',
  checkId: completionCheck.checkId,
  click: completionClicks[3],
  stateVersion: completionState.stateVersion,
};
const concurrentCompletions = await Promise.all([
  api(readyEndpoint, finalPayload, completionHeaders),
  api(readyEndpoint, finalPayload, completionHeaders),
]);
assert.deepEqual(
  concurrentCompletions.map((result) => result.response.status).sort((left, right) => left - right),
  [201, 409],
  JSON.stringify(concurrentCompletions.map((result) => result.body)),
);
assert.equal(concurrentCompletions.filter((result) => result.body.proofToken).length, 1);
process.stdout.write('✓ Concurrent fourth presses issue exactly one proof.\n');

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
