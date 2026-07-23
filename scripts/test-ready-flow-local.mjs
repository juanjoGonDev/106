import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const gameEndpoint = process.env.SUPABASE_FUNCTION_URL
  ?? 'http://127.0.0.1:54321/functions/v1/game-api';
const readyEndpoint = gameEndpoint.replace(/\/[^/]+$/, '/game-ready-api');
const origin = 'http://127.0.0.1:3000';
const countdownMs = 3_000;
const elapsedMs = 2_200;
const timeoutElapsedMs = 30_000;

async function readJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Expected JSON from ${response.url}, received: ${text.slice(0, 500)}`);
  }
}

async function api(endpoint, body, headers) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin,
      ...headers,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  return { response, body: await readJson(response) };
}

function clicksFor(balls, pointerType = 'touch') {
  return balls.map((ball, index) => ({
    x: ball.x,
    y: ball.y,
    atMs: 240 + index * 320,
    pointerType,
    trusted: true,
  }));
}

function assertMoved(previous, next) {
  for (const priorBall of previous) {
    const replacement = next.find((ball) => ball.order === priorBall.order);
    assert.ok(replacement, `Missing replacement for ball ${priorBall.order}`);
    assert.ok(
      Math.hypot(replacement.x - priorBall.x, replacement.y - priorBall.y) >= 12,
      `Ball ${priorBall.order} did not move far enough`,
    );
  }
}

function validTouchSignals(interaction) {
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
    userActivation: false,
    automationDetected: false,
    pointerType: 'touch',
    pointerXPercent: interaction.xPercent,
    pointerYPercent: interaction.yPercent,
    pointerMoveCount: 3,
    pointerTravelPx: 34,
    pointerDwellMs: 120,
    pressureMax: 0.5,
    holdDurationMs: 0,
    samePointer: true,
  };
}

function automaticTimeoutSignals(interaction) {
  return {
    trustedStart: true,
    trustedFinish: true,
    timerConcealed: true,
    visibilityChanges: 0,
    focusLosses: 0,
    interactionMode: 'press',
    controlNonce: interaction.nonce,
    finishEvent: 'timeout',
    pointerTrusted: true,
    userActivation: false,
    automationDetected: false,
    pointerType: 'timeout',
    pointerXPercent: interaction.xPercent,
    pointerYPercent: interaction.yPercent,
    pointerMoveCount: 0,
    pointerTravelPx: 0,
    pointerDwellMs: 0,
    pressureMax: 0,
    holdDurationMs: 0,
    samePointer: true,
    automaticFinish: true,
  };
}

function createHeaders(prefix) {
  return {
    'x-account-token': randomBytes(32).toString('hex'),
    'x-device-id': `${prefix}-${randomUUID()}`,
  };
}

async function createPreparedAttempt({ nick, team, headers }) {
  const check = await api(readyEndpoint, { action: 'human-check' }, headers);
  assert.equal(check.response.status, 201, JSON.stringify(check.body));
  assert.equal(check.body.balls?.length, 4);

  const completed = await api(readyEndpoint, {
    action: 'complete-human-check',
    checkId: check.body.checkId,
    clicks: clicksFor(check.body.balls),
  }, headers);
  assert.equal(completed.response.status, 201, JSON.stringify(completed.body));

  const prepared = await api(readyEndpoint, {
    action: 'prepare-start',
    nick,
    team,
    humanCheckId: completed.body.checkId,
    humanProofToken: completed.body.proofToken,
  }, headers);
  assert.equal(prepared.response.status, 201, JSON.stringify(prepared.body));

  const activationRequestedAt = Date.now();
  const activated = await api(readyEndpoint, {
    action: 'activate-start',
    challengeId: prepared.body.challengeId,
    countdownMs,
  }, headers);
  assert.equal(activated.response.status, 200, JSON.stringify(activated.body));
  const startsAt = Date.parse(activated.body.startsAt);
  assert.ok(startsAt - activationRequestedAt >= 2_850, `Countdown lead too short: ${startsAt - activationRequestedAt}`);
  assert.ok(startsAt - activationRequestedAt <= 3_500, `Countdown lead too long: ${startsAt - activationRequestedAt}`);
  return { prepared, startsAt };
}

const suffix = Date.now().toString(36).slice(-8);
const nick = `CIReady${suffix}`.slice(0, 24);
const headers = createHeaders('ci-ready');

const health = await api(readyEndpoint, { action: 'health' }, {});
assert.equal(health.response.status, 200, JSON.stringify(health.body));
assert.deepEqual(health.body, { ok: true, contract: 'prepared-countdown-v1' });
process.stdout.write('✓ Readiness backend publishes the deployment compatibility contract.\n');

const firstCheck = await api(readyEndpoint, { action: 'human-check' }, headers);
assert.equal(firstCheck.response.status, 201, JSON.stringify(firstCheck.body));
assert.equal(firstCheck.body.balls?.length, 4);

const replacementCheck = await api(readyEndpoint, {
  action: 'human-check',
  previousBalls: firstCheck.body.balls,
}, headers);
assert.equal(replacementCheck.response.status, 201, JSON.stringify(replacementCheck.body));
assert.notEqual(replacementCheck.body.checkId, firstCheck.body.checkId);
assertMoved(firstCheck.body.balls, replacementCheck.body.balls);
process.stdout.write('✓ Incorrect captcha regeneration receives a new ID and materially different ball positions.\n');

const completed = await api(readyEndpoint, {
  action: 'complete-human-check',
  checkId: replacementCheck.body.checkId,
  clicks: clicksFor(replacementCheck.body.balls),
}, headers);
assert.equal(completed.response.status, 201, JSON.stringify(completed.body));
assert.match(String(completed.body.proofToken), /^[a-f0-9]{64}$/i);
const proofLifetimeMs = Date.parse(completed.body.expiresAt) - Date.now();
assert.ok(proofLifetimeMs > 110_000 && proofLifetimeMs <= 121_000, `Unexpected proof lifetime ${proofLifetimeMs}`);
process.stdout.write('✓ Completed captcha proof remains valid for the two-minute ready window.\n');

const prepared = await api(readyEndpoint, {
  action: 'prepare-start',
  nick,
  team: 'argentina',
  humanCheckId: completed.body.checkId,
  humanProofToken: completed.body.proofToken,
}, headers);
assert.equal(prepared.response.status, 201, JSON.stringify(prepared.body));
assert.equal(prepared.body.prepared, true);
assert.equal(prepared.body.interaction?.mode, 'press');
assert.match(String(prepared.body.challengeId), /^[0-9a-f-]{36}$/i);
const readyLifetimeMs = Date.parse(prepared.body.readyExpiresAt) - Date.now();
assert.ok(readyLifetimeMs > 110_000 && readyLifetimeMs <= 121_000, `Unexpected ready lifetime ${readyLifetimeMs}`);
process.stdout.write('✓ Server challenge is prepared without starting the timed attempt.\n');

const prematureFinish = await api(gameEndpoint, {
  action: 'finish',
  challengeId: prepared.body.challengeId,
  clientElapsedMs: elapsedMs,
  clientSignals: validTouchSignals(prepared.body.interaction),
}, headers);
assert.equal(prematureFinish.response.status, 400, JSON.stringify(prematureFinish.body));
assert.equal(typeof prematureFinish.body.error, 'string');
process.stdout.write('✓ A prepared challenge cannot finish before the explicit ready activation.\n');

const invalidActivation = await api(readyEndpoint, {
  action: 'activate-start',
  challengeId: prepared.body.challengeId,
  countdownMs: 2_999,
}, headers);
assert.equal(invalidActivation.response.status, 400, JSON.stringify(invalidActivation.body));

const activationRequestedAt = Date.now();
const activated = await api(readyEndpoint, {
  action: 'activate-start',
  challengeId: prepared.body.challengeId,
  countdownMs,
}, headers);
assert.equal(activated.response.status, 200, JSON.stringify(activated.body));
const startsAt = Date.parse(activated.body.startsAt);
assert.ok(startsAt - activationRequestedAt >= 2_850, `Countdown lead too short: ${startsAt - activationRequestedAt}`);
assert.ok(startsAt - activationRequestedAt <= 3_500, `Countdown lead too long: ${startsAt - activationRequestedAt}`);

const repeatedActivation = await api(readyEndpoint, {
  action: 'activate-start',
  challengeId: prepared.body.challengeId,
  countdownMs,
}, headers);
assert.equal(repeatedActivation.response.status, 409, JSON.stringify(repeatedActivation.body));
process.stdout.write('✓ Ready activation is exactly three seconds ahead and can be consumed only once.\n');

await delay(Math.max(0, startsAt - Date.now()) + elapsedMs);
const finished = await api(gameEndpoint, {
  action: 'finish',
  challengeId: prepared.body.challengeId,
  clientElapsedMs: elapsedMs,
  clientSignals: validTouchSignals(prepared.body.interaction),
}, headers);
assert.equal(finished.response.status, 201, JSON.stringify(finished.body));
assert.equal(finished.body.attempt?.verified, true, JSON.stringify(finished.body));
assert.equal(finished.body.attempt?.differenceMs, 8_400);
process.stdout.write('✓ Mobile touch is accepted at the 2-second concealed-timer lower bound.\n');

const timeoutHeaders = createHeaders('ci-timeout');
const timeoutNick = `CITimeout${suffix}`.slice(0, 24);
const timeoutAttempt = await createPreparedAttempt({
  nick: timeoutNick,
  team: 'spain',
  headers: timeoutHeaders,
});
await delay(Math.max(0, timeoutAttempt.startsAt - Date.now()) + timeoutElapsedMs);
const timedOut = await api(gameEndpoint, {
  action: 'finish',
  challengeId: timeoutAttempt.prepared.body.challengeId,
  clientElapsedMs: timeoutElapsedMs,
  clientSignals: automaticTimeoutSignals(timeoutAttempt.prepared.body.interaction),
}, timeoutHeaders);
assert.equal(timedOut.response.status, 201, JSON.stringify(timedOut.body));
assert.equal(timedOut.body.attempt?.verified, true, JSON.stringify(timedOut.body));
assert.equal(timedOut.body.attempt?.elapsedMs, timeoutElapsedMs);
assert.equal(timedOut.body.attempt?.differenceMs, 19_400);
assert.equal(timedOut.body.attemptsLeft, 4);
process.stdout.write('✓ The exact 30-second deadline consumes one attempt through the real Edge and PostgreSQL path.\n');
