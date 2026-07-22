import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const endpoint = process.env.SUPABASE_FUNCTION_URL
  ?? 'http://127.0.0.1:54321/functions/v1/game-api';
const origin = 'http://127.0.0.1:3000';

async function readJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Expected JSON from ${response.url}, received: ${text.slice(0, 500)}`);
  }
}

async function api(body, headers) {
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

async function createTouchProof(headers) {
  const created = await api({ action: 'human-check' }, headers);
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.balls?.length, 4, JSON.stringify(created.body));

  const clicks = created.body.balls.map((ball, index) => ({
    x: ball.x,
    y: ball.y,
    atMs: 220 + index * 300,
    pointerType: 'touch',
    trusted: true,
  }));
  const completed = await api({
    action: 'complete-human-check',
    checkId: created.body.checkId,
    clicks,
  }, headers);
  assert.equal(completed.response.status, 201, JSON.stringify(completed.body));
  assert.match(String(completed.body.proofToken), /^[a-f0-9]{64}$/i);
  return {
    humanCheckId: completed.body.checkId,
    humanProofToken: completed.body.proofToken,
  };
}

const suffix = Date.now().toString(36).slice(-8);
const nick = `CITouch${suffix}`.slice(0, 24);
const headers = {
  'x-account-token': randomBytes(32).toString('hex'),
  'x-device-id': `ci-touch-${randomUUID()}`,
};
const proof = await createTouchProof(headers);
const started = await api({
  action: 'start',
  nick,
  team: 'argentina',
  ...proof,
}, headers);
assert.equal(started.response.status, 201, JSON.stringify(started.body));
assert.equal(started.body.interaction?.mode, 'press');
assert.match(String(started.body.interaction?.nonce), /^[0-9a-f-]{36}$/i);

await delay(10_600);
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
    interactionMode: 'press',
    controlNonce: started.body.interaction.nonce,
    finishEvent: 'pointerdown',
    pointerTrusted: true,
    userActivation: false,
    userActivationSupported: false,
    automationDetected: false,
    pointerType: 'touch',
    pointerXPercent: started.body.interaction.xPercent,
    pointerYPercent: started.body.interaction.yPercent,
    pointerMoveCount: 2,
    pointerTravelPx: 18,
    pointerDwellMs: 80,
    pressureMax: 0.5,
    holdDurationMs: 0,
    samePointer: true,
  },
}, headers);

assert.equal(finished.response.status, 201, JSON.stringify(finished.body));
assert.equal(finished.body.attempt?.verified, true, JSON.stringify(finished.body));
assert.equal(finished.body.attempt?.differenceMs, 0, JSON.stringify(finished.body));
process.stdout.write('✓ A trusted mobile touch stop succeeds when the User Activation API is unavailable.\n');
