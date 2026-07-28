import assert from 'node:assert/strict';

const gameEndpoint = process.env.SUPABASE_FUNCTION_URL
  ?? 'http://127.0.0.1:54321/functions/v1/game-api';
const playerContextEndpoint = gameEndpoint.replace(/\/game-api$/, '/player-context');
const leagueEndpoint = gameEndpoint.replace(/\/game-api$/, '/league-api');
const origin = 'http://127.0.0.1:3000';
const privateHeaders = {
  'x-account-token': 'a'.repeat(64),
  'x-device-id': 'security-device-106-0001',
};

async function request(url, body, headers = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin,
      ...headers,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  try {
    return { response, payload: text ? JSON.parse(text) : {} };
  } catch {
    throw new Error(`Expected JSON from ${url}, received: ${text.slice(0, 300)}`);
  }
}

function log(message) {
  process.stdout.write(`✓ ${message}\n`);
}

for (const [nick, expectedAvailability] of [
  ['..', 'invalid-too_short'],
  ['../..', 'invalid-invalid_characters'],
  ['admin', 'invalid-reserved'],
  ['pedofilo', 'invalid-offensive'],
]) {
  const result = await request(playerContextEndpoint, { action: 'player-context', nick });
  assert.equal(result.response.status, 200, JSON.stringify(result.payload));
  assert.equal(result.payload.availability, expectedAvailability);
  assert.equal(result.payload.profile, null);
  assert.deepEqual(result.payload.leagues, []);
}
log('Debounced player context rejects malformed, reserved and offensive nicknames');

const sqlNickname = "x' OR 1=1; DROP TABLE game_players; --";
const writeAttempt = await request(gameEndpoint, {
  action: 'access-status',
  nick: sqlNickname,
}, privateHeaders);
assert.equal(writeAttempt.response.status, 400, JSON.stringify(writeAttempt.payload));
assert.match(String(writeAttempt.payload.code), /^nick_/);
log('SQL-like nickname payload is rejected before a write or CAPTCHA boundary');

const profileProbe = await request(gameEndpoint, { action: 'profile', nick: sqlNickname });
assert.equal(profileProbe.response.status, 400, JSON.stringify(profileProbe.payload));
assert.equal(profileProbe.payload.code, 'nick_invalid_characters');
log('Read-only profile lookup rejects malformed nickname input before the database boundary');

const searchPayload = "%' OR 1=1; DROP TABLE game_leagues; --";
const leagueSearch = await request(leagueEndpoint, {
  action: 'list-leagues',
  search: searchPayload,
  visibility: 'all',
});
assert.equal(leagueSearch.response.status, 200, JSON.stringify(leagueSearch.payload));
assert.ok(Array.isArray(leagueSearch.payload));
log('League search passes SQL-like text through a bounded RPC parameter');

const leagueWrite = await request(leagueEndpoint, {
  action: 'create-league',
  nick: sqlNickname,
  name: 'Security test',
  visibility: 'private',
  durationDays: 3,
  maxParticipants: 10,
}, privateHeaders);
assert.equal(leagueWrite.response.status, 400, JSON.stringify(leagueWrite.payload));
log('League mutation rejects an invalid nickname before authorization or persistence');

const [statsAfter, leaguesAfter] = await Promise.all([
  request(gameEndpoint, { action: 'stats' }),
  request(leagueEndpoint, { action: 'list-leagues', search: '', visibility: 'all' }),
]);
assert.equal(statsAfter.response.status, 200, JSON.stringify(statsAfter.payload));
assert.equal(leaguesAfter.response.status, 200, JSON.stringify(leaguesAfter.payload));
assert.ok(Array.isArray(leaguesAfter.payload));
log('Database and public APIs remain healthy after every injection probe');
