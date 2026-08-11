import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';

const supabaseUrl = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const serviceKey = process.env.SUPABASE_SECRET_KEY
  || process.env.SUPABASE_SERVICE_ROLE_KEY
  || 'sb_secret_test_service_role_key_0000000000000000000000000000000000000000';
const hashPepper = process.env.HASH_PEPPER || 'local-test-hash-pepper-00000000000000000000000000000000';
const origin = 'http://127.0.0.1:3000';

function randomHex(bytes = 16) {
  return randomBytes(bytes).toString('hex');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function accountTokenHash(token) {
  return sha256(`${hashPepper}:account:${token}`);
}

function zadminDigest(label, value) {
  return sha256(`${hashPepper}:${label}:${value}`);
}

function serviceHeaders(extra = {}) {
  return {
    apikey: serviceKey,
    authorization: `Bearer ${serviceKey}`,
    'content-type': 'application/json',
    ...extra,
  };
}

async function request(path, { method = 'GET', body, headers = {}, expected = 200 } = {}) {
  const response = await fetch(`${supabaseUrl}${path}`, {
    method,
    headers: serviceHeaders(headers),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  if (response.status !== expected) {
    throw new Error(`${method} ${path} returned ${response.status}, expected ${expected}: ${text.slice(0, 700)}`);
  }
  return payload;
}

async function rpc(name, body) {
  return request(`/rest/v1/rpc/${name}`, { method: 'POST', body });
}

async function selectOne(table, query) {
  const rows = await request(`/rest/v1/${table}?${query}`);
  assert.ok(Array.isArray(rows));
  assert.equal(rows.length, 1, `${table} query should return exactly one row`);
  return rows[0];
}

async function insertOne(table, body) {
  const rows = await request(`/rest/v1/${table}?select=*`, {
    method: 'POST',
    body,
    headers: { Prefer: 'return=representation' },
    expected: 201,
  });
  assert.ok(Array.isArray(rows) && rows.length === 1, `${table} insert should return one row`);
  return rows[0];
}

async function managementRequest(rawSessionToken, deviceId, ip, action, payload = {}, expected = 200) {
  const response = await fetch(`${supabaseUrl}/functions/v1/zadmin-management`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${rawSessionToken}`,
      'x-device-id': deviceId,
      'x-forwarded-for': ip,
      origin,
    },
    body: JSON.stringify({ action, ...payload }),
  });
  const result = await response.json().catch(() => ({}));
  assert.equal(response.status, expected, `zadmin-management ${action}: ${JSON.stringify(result)}`);
  return result;
}

async function playerNameRequest(rawAccountToken, action, payload = {}, expected = 200) {
  const response = await fetch(`${supabaseUrl}/functions/v1/player-name-management`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-account-token': rawAccountToken,
      origin,
    },
    body: JSON.stringify({ action, ...payload }),
  });
  const result = await response.json().catch(() => ({}));
  assert.equal(response.status, expected, `player-name-management ${action}: ${JSON.stringify(result)}`);
  return result;
}

async function ensurePlayer({ nick, accountToken, deviceHash, ipHash }) {
  const nickKey = nick.toLocaleLowerCase('es');
  const result = await rpc('ensure_game_account_player', {
    p_nick: nick,
    p_nick_key: nickKey,
    p_device_hash: deviceHash,
    p_ip_hash: ipHash,
    p_account_token_hash: accountTokenHash(accountToken),
    p_legacy_token_hash: null,
  });
  assert.equal(result?.error, undefined, `ensure player failed: ${JSON.stringify(result)}`);
  const link = await selectOne(
    'game_account_players',
    `nick_key=eq.${encodeURIComponent(nickKey)}&select=account_id,player_id,nick_key`,
  );
  assert.match(String(link.account_id), /^[0-9a-f-]{36}$/i);
  assert.match(String(link.player_id), /^[0-9a-f-]{36}$/i);
  return { ...link, nick, nickKey };
}

async function createAttempt({ nick, nickKey, deviceHash, ipHash }) {
  const now = new Date();
  const startedAt = now.toISOString();
  const targetAt = new Date(now.getTime() + 10_600).toISOString();
  const challenge = await insertOne('game_challenges', {
    nick,
    nick_key: nickKey,
    team: 'spain',
    device_hash: deviceHash,
    ip_hash: ipHash,
    server_started_at: startedAt,
    target_started_at: targetAt,
    expires_at: new Date(now.getTime() + 120_000).toISOString(),
    consumed_at: new Date(now.getTime() + 10_601).toISOString(),
  });
  return insertOne('game_attempts', {
    challenge_id: challenge.id,
    nick,
    nick_key: nickKey,
    team: 'spain',
    device_hash: deviceHash,
    ip_hash: ipHash,
    client_elapsed_ms: 10_601,
    server_elapsed_ms: 10_601,
    difference_ms: 1,
    verified: true,
    reasons: [],
    created_at: new Date(now.getTime() + 10_601).toISOString(),
  });
}

async function main() {
  const suffix = randomHex(5);
  const originalNick = `Mgmt${suffix}`;
  const renamedNick = `Ren${suffix}`;
  const finalNick = `Final${suffix}`;
  const conflictNick = `Taken${suffix}`;
  const deviceHash = sha256(`device:${suffix}`);
  const ipHash = sha256(`ip:${suffix}`);
  const rawAccountToken = randomHex(32);
  const wrongAccountToken = randomHex(32);
  const player = await ensurePlayer({ nick: originalNick, accountToken: rawAccountToken, deviceHash, ipHash });
  const originalPlayerId = player.player_id;

  const attempt = await createAttempt(player);
  const adminToken = randomHex(32);
  const adminDeviceId = `za-${randomHex(24)}`;
  const adminIp = '198.51.100.77';
  const adminSession = await insertOne('game_admin_sessions', {
    token_hash: zadminDigest('zadmin-session', adminToken),
    ip_hash: zadminDigest('zadmin-ip', adminIp),
    device_hash: zadminDigest('zadmin-device', adminDeviceId),
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  });

  const evidence = { fixture: 'admin-management', nonce: suffix };
  const integrityBan = await insertOne('game_integrity_bans', {
    scope: 'account',
    account_id: player.account_id,
    reason: 'admin-management-fixture',
    source_attempt_id: attempt.id,
    triggered_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    policy_version: 3,
    evidence,
  });

  let active = await rpc('get_game_active_integrity_ban_for_account', {
    p_account_id: player.account_id,
    p_device_hash: deviceHash,
    p_ip_hash: ipHash,
    p_at: new Date().toISOString(),
  });
  assert.equal(active.banned, true, 'fixture automatic restriction should start active');

  const restrictionList = await managementRequest(adminToken, adminDeviceId, adminIp, 'restrictions', {
    status: 'active',
    scope: 'account',
    search: player.account_id,
  });
  const listed = restrictionList.restrictions.find((item) => String(item.id) === String(integrityBan.id));
  assert.equal(listed?.source, 'integrity');
  assert.equal(listed?.status, 'active');

  await managementRequest(adminToken, adminDeviceId, adminIp, 'lift-integrity-restriction', {
    banId: integrityBan.id,
    reason: 'False positive confirmed by operator',
  });
  active = await rpc('get_game_active_integrity_ban_for_account', {
    p_account_id: player.account_id,
    p_device_hash: deviceHash,
    p_ip_hash: ipHash,
    p_at: new Date().toISOString(),
  });
  assert.equal(active.banned, false, 'lift must affect canonical gameplay enforcement');

  const untouchedBan = await selectOne('game_integrity_bans', `id=eq.${integrityBan.id}&select=id,evidence,expires_at,reason`);
  assert.deepEqual(untouchedBan.evidence, evidence, 'lifting must not rewrite detector evidence');
  assert.equal(untouchedBan.reason, 'admin-management-fixture');

  await managementRequest(adminToken, adminDeviceId, adminIp, 'reinstate-integrity-restriction', {
    banId: integrityBan.id,
    reason: 'Restriction should remain active after review',
  });
  active = await rpc('get_game_active_integrity_ban_for_account', {
    p_account_id: player.account_id,
    p_device_hash: deviceHash,
    p_ip_hash: ipHash,
    p_at: new Date().toISOString(),
  });
  assert.equal(active.banned, true, 'reinstate must restore canonical enforcement before original expiry');

  const renamed = await managementRequest(adminToken, adminDeviceId, adminIp, 'rename-player', {
    playerId: originalPlayerId,
    nick: renamedNick,
    reason: 'Administrative rename fixture',
  });
  assert.equal(renamed.playerId, originalPlayerId);
  assert.equal(renamed.newNick, renamedNick);
  const renamedPlayer = await selectOne('game_players', `player_id=eq.${originalPlayerId}&select=player_id,nick,nick_key`);
  assert.equal(renamedPlayer.player_id, originalPlayerId);
  assert.equal(renamedPlayer.nick, renamedNick);
  const renamedLink = await selectOne('game_account_players', `player_id=eq.${originalPlayerId}&select=player_id,nick_key,account_id`);
  assert.equal(renamedLink.nick_key, renamedNick.toLocaleLowerCase('es'));
  const renamedAttempt = await selectOne('game_attempts', `id=eq.${attempt.id}&select=id,nick,nick_key,difference_ms`);
  assert.equal(renamedAttempt.nick, renamedNick);
  assert.equal(renamedAttempt.nick_key, renamedNick.toLocaleLowerCase('es'));
  assert.equal(renamedAttempt.difference_ms, 1);

  await managementRequest(adminToken, adminDeviceId, adminIp, 'require-player-rename', {
    playerId: originalPlayerId,
    reason: 'Nickname violates moderation rules',
  });
  const requiredPlayer = await selectOne('game_players', `player_id=eq.${originalPlayerId}&select=player_id,nick,nick_key`);
  assert.match(requiredPlayer.nick, /^Jugador-[0-9a-f]{12,16}$/i);
  assert.equal(requiredPlayer.player_id, originalPlayerId);

  const status = await playerNameRequest(rawAccountToken, 'status');
  assert.equal(status.requirement?.required, true);
  assert.equal(status.requirement?.playerId, originalPlayerId);
  assert.equal(status.requirement?.temporaryNick, requiredPlayer.nick);
  assert.equal(status.requirement?.reason, 'Tu nombre de jugador debe cambiarse antes de continuar.');

  const blockedEnsure = await rpc('ensure_game_account_player', {
    p_nick: requiredPlayer.nick,
    p_nick_key: requiredPlayer.nick_key,
    p_device_hash: deviceHash,
    p_ip_hash: ipHash,
    p_account_token_hash: accountTokenHash(rawAccountToken),
    p_legacy_token_hash: null,
  });
  assert.equal(blockedEnsure.error, 'nickname_change_required');

  await playerNameRequest(wrongAccountToken, 'complete', {
    playerId: originalPlayerId,
    nick: finalNick,
  }, 403);

  const completed = await playerNameRequest(rawAccountToken, 'complete', {
    playerId: originalPlayerId,
    nick: finalNick,
  });
  assert.equal(completed.required, false);
  assert.equal(completed.playerId, originalPlayerId);
  assert.equal(completed.newNick, finalNick);

  const finalPlayer = await selectOne('game_players', `player_id=eq.${originalPlayerId}&select=player_id,nick,nick_key`);
  assert.equal(finalPlayer.player_id, originalPlayerId);
  assert.equal(finalPlayer.nick, finalNick);
  const requirement = await selectOne('game_player_name_requirements', `player_id=eq.${originalPlayerId}&select=player_id,required,resolved_at`);
  assert.equal(requirement.required, false);
  assert.ok(requirement.resolved_at);

  const unblockedEnsure = await rpc('ensure_game_account_player', {
    p_nick: finalNick,
    p_nick_key: finalNick.toLocaleLowerCase('es'),
    p_device_hash: deviceHash,
    p_ip_hash: ipHash,
    p_account_token_hash: accountTokenHash(rawAccountToken),
    p_legacy_token_hash: null,
  });
  assert.equal(unblockedEnsure.error, undefined, `rename completion should restore normal authorization: ${JSON.stringify(unblockedEnsure)}`);

  const conflictAccountToken = randomHex(32);
  const conflictPlayer = await ensurePlayer({
    nick: conflictNick,
    accountToken: conflictAccountToken,
    deviceHash: sha256(`device-conflict:${suffix}`),
    ipHash: sha256(`ip-conflict:${suffix}`),
  });
  assert.notEqual(conflictPlayer.player_id, originalPlayerId);

  const conflict = await managementRequest(adminToken, adminDeviceId, adminIp, 'rename-player', {
    playerId: originalPlayerId,
    nick: conflictNick,
    reason: 'Conflict must fail atomically',
  }, 409);
  assert.equal(conflict.code, 'nickname_taken');
  const afterConflict = await selectOne('game_players', `player_id=eq.${originalPlayerId}&select=player_id,nick`);
  assert.equal(afterConflict.nick, finalNick, 'failed rename must not partially mutate the current player');

  const actions = await request(`/rest/v1/game_integrity_ban_admin_actions?ban_id=eq.${integrityBan.id}&select=action,reason&order=id.asc`);
  assert.deepEqual(actions.map((item) => item.action), ['lift', 'reinstate']);
  const nicknameActions = await request(`/rest/v1/game_admin_nickname_actions?player_id=eq.${originalPlayerId}&select=action,old_nick,new_nick&order=id.asc`);
  assert.deepEqual(nicknameActions.map((item) => item.action), ['rename', 'require_change', 'resolve_change']);

  const updateAttempt = await fetch(`${supabaseUrl}/rest/v1/game_integrity_ban_admin_actions?ban_id=eq.${integrityBan.id}`, {
    method: 'PATCH',
    headers: serviceHeaders({ Prefer: 'return=minimal' }),
    body: JSON.stringify({ reason: 'must fail' }),
  });
  assert.ok(updateAttempt.status >= 400, 'append-only automatic restriction history must reject UPDATE');

  const nicknameUpdate = await fetch(`${supabaseUrl}/rest/v1/game_admin_nickname_actions?player_id=eq.${originalPlayerId}`, {
    method: 'DELETE',
    headers: serviceHeaders({ Prefer: 'return=minimal' }),
  });
  assert.ok(nicknameUpdate.status >= 400, 'append-only nickname action history must reject DELETE');

  assert.match(String(adminSession.id), /^[0-9a-f-]{36}$/i);
  console.log('✓ admin restriction + nickname management integration passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
