import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

function readLocalEnvironment() {
  const result = spawnSync('supabase', ['status', '-o', 'env'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`supabase status failed: ${result.stderr || result.stdout}`);
  const values = {};
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(?:"([^"]*)"|'([^']*)'|(.*))$/);
    if (match) values[match[1]] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  const apiUrl = values.API_URL || values.SUPABASE_URL;
  const serviceRoleKey = values.SERVICE_ROLE_KEY;
  if (!apiUrl || !serviceRoleKey) throw new Error('Local Supabase API_URL or SERVICE_ROLE_KEY is missing.');
  return { apiUrl: apiUrl.replace(/\/$/, ''), serviceRoleKey };
}

const { apiUrl, serviceRoleKey } = readLocalEnvironment();
const headers = {
  apikey: serviceRoleKey,
  authorization: `Bearer ${serviceRoleKey}`,
  'content-type': 'application/json',
};

async function request(path, options = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...headers,
      ...(options.returnRepresentation ? { prefer: 'return=representation' } : {}),
      ...options.headers,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${options.method ?? 'GET'} ${path} failed (${response.status}): ${text}`);
  return body;
}

function rpc(name, body = {}) {
  return request(`/rest/v1/rpc/${name}`, { method: 'POST', body });
}

function table(name, query = '') {
  return request(`/rest/v1/${name}${query ? `?${query}` : ''}`);
}

function insert(name, rows) {
  return request(`/rest/v1/${name}`, {
    method: 'POST',
    body: rows,
    returnRepresentation: true,
  });
}

function madridDate(offsetDays = 0) {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const instant = new Date(`${today}T12:00:00Z`);
  instant.setUTCDate(instant.getUTCDate() + offsetDays);
  return instant.toISOString().slice(0, 10);
}

function timestamp(date, minute = 0) {
  const hours = 10 + Math.floor(minute / 60);
  const minutes = minute % 60;
  return `${date}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00+02:00`;
}

function makePlayer(prefix, suffix, { deviceHash, ipHash } = {}) {
  const nick = `${prefix}${suffix}`.slice(0, 24);
  return {
    nick,
    nick_key: nick.toLocaleLowerCase('es'),
    first_device_hash: deviceHash ?? `device-${prefix}-${suffix}`,
    first_ip_hash: ipHash ?? `ip-${prefix}-${suffix}`,
  };
}

function humanTelemetry(sequence) {
  return {
    interactionMode: 'press',
    finishEvent: 'pointerdown',
    pointerType: 'mouse',
    pointerMoveCount: 4 + sequence,
    pointerTravelPx: 70 + sequence * 11,
    pointerDwellMs: 280 + sequence * 37,
    pressureMax: Number((0.45 + sequence * 0.01).toFixed(2)),
    userActivation: true,
    automationDetected: false,
    automaticFinish: false,
  };
}

const automationTelemetry = Object.freeze({
  interactionMode: 'press',
  finishEvent: 'pointerdown',
  pointerType: 'mouse',
  pointerMoveCount: 0,
  pointerTravelPx: 0,
  pointerDwellMs: 0,
  pressureMax: 0.5,
  userActivation: false,
  automationDetected: false,
  automaticFinish: false,
});

async function insertAttempt({ participant, date, minute, difference, telemetry, verified = true }) {
  const challengeId = randomUUID();
  const attemptId = randomUUID();
  const createdAt = timestamp(date, minute);
  await insert('game_challenges', [{
    id: challengeId,
    nick: participant.nick,
    nick_key: participant.nick_key,
    team: minute % 2 === 0 ? 'spain' : 'argentina',
    device_hash: participant.first_device_hash,
    ip_hash: participant.first_ip_hash,
    started_at: createdAt,
    expires_at: new Date(new Date(createdAt).getTime() + 30_000).toISOString(),
    consumed_at: createdAt,
  }]);
  await insert('game_attempts', [{
    id: attemptId,
    challenge_id: challengeId,
    nick: participant.nick,
    nick_key: participant.nick_key,
    team: minute % 2 === 0 ? 'spain' : 'argentina',
    device_hash: participant.first_device_hash,
    ip_hash: participant.first_ip_hash,
    client_elapsed_ms: 10_600 + difference,
    server_elapsed_ms: 10_600 + difference,
    difference_ms: difference,
    verified,
    verification_reasons: verified ? [] : ['fixture_unverified'],
    client_signals: telemetry,
    created_at: createdAt,
  }]);
  return attemptId;
}

function logStep(message) {
  process.stdout.write(`✓ ${message}\n`);
}

async function assertAttemptVerification(ids, expected) {
  const rows = await table(
    'game_attempts',
    `id=in.(${ids.join(',')})&select=id,verified&order=created_at.asc`,
  );
  assert.equal(rows.length, ids.length);
  assert.ok(rows.every((row) => row.verified === expected), JSON.stringify(rows));
}

async function run() {
  const prefix = `I${Date.now().toString(36).slice(-6)}`;

  // Precision is evidence, not guilt: one strong player may legitimately be excellent repeatedly.
  const skilledDate = madridDate(-33);
  const skilled = makePlayer(prefix, 'Skilled');
  await insert('game_players', [skilled]);
  const skilledIds = [];
  for (let index = 0; index < 5; index += 1) {
    const id = await insertAttempt({
      participant: skilled,
      date: skilledDate,
      minute: index,
      difference: index,
      telemetry: humanTelemetry(index),
    });
    skilledIds.push(id);
    const decision = await rpc('reassess_game_integrity_cluster', { p_anchor_attempt_id: id });
    assert.notEqual(decision.status, 'excluded', JSON.stringify(decision));
  }
  await assertAttemptVerification(skilledIds, true);
  logStep('Repeated near-perfect skill on one identity remains ranking-eligible');

  // IP is deliberately weak: unrelated devices behind one network must not convict each other.
  const sharedIpDate = madridDate(-32);
  const sharedIp = `shared-ip-${prefix}`;
  const sharedIpIds = [];
  const sharedIpPlayers = Array.from({ length: 6 }, (_, index) => makePlayer(prefix, `Ip${index}`, {
    deviceHash: `shared-ip-device-${prefix}-${index}`,
    ipHash: sharedIp,
  }));
  await insert('game_players', sharedIpPlayers);
  for (let index = 0; index < sharedIpPlayers.length; index += 1) {
    const id = await insertAttempt({
      participant: sharedIpPlayers[index],
      date: sharedIpDate,
      minute: index,
      difference: 1,
      telemetry: humanTelemetry(index),
    });
    sharedIpIds.push(id);
    const decision = await rpc('reassess_game_integrity_cluster', { p_anchor_attempt_id: id });
    assert.notEqual(decision.status, 'excluded', JSON.stringify(decision));
  }
  await assertAttemptVerification(sharedIpIds, true);
  const sharedIpEvidence = await rpc('game_attempt_integrity_evidence', {
    p_anchor_attempt_id: sharedIpIds.at(-1),
  });
  assert.equal(sharedIpEvidence.sameIpNearPerfect, 6);
  assert.equal(sharedIpEvidence.sameIpDevices, 6);
  logStep('Shared IP correlation alone never excludes independent devices');

  // Persist an honest fallback winner, then prove a later cross-nick automation pattern can
  // retrospectively remove the old winner and give the trophy to the rightful player.
  const fraudDate = madridDate(-31);
  const suspiciousDevice = `suspicious-device-${prefix}`;
  const suspiciousIp = `suspicious-ip-${prefix}`;
  const suspiciousPlayers = ['A', 'B', 'C', 'D'].map((suffix) => makePlayer(prefix, `Risk${suffix}`, {
    deviceHash: suspiciousDevice,
    ipHash: suspiciousIp,
  }));
  const fallback = makePlayer(prefix, 'Fallback');
  await insert('game_players', [...suspiciousPlayers, fallback]);

  const firstSuspiciousId = await insertAttempt({
    participant: suspiciousPlayers[0],
    date: fraudDate,
    minute: 0,
    difference: 0,
    telemetry: automationTelemetry,
  });
  await rpc('reassess_game_integrity_cluster', { p_anchor_attempt_id: firstSuspiciousId });

  const fallbackIds = [];
  for (let index = 0; index < 3; index += 1) {
    fallbackIds.push(await insertAttempt({
      participant: fallback,
      date: fraudDate,
      minute: 10 + index,
      difference: 10 + index * 10,
      telemetry: humanTelemetry(index),
    }));
  }
  await rpc('reconcile_game_trophies_for_date', { p_award_date: fraudDate });

  let trophies = await table(
    'game_daily_trophies',
    `award_date=eq.${fraudDate}&select=trophy_type,nick_key&order=trophy_type.asc`,
  );
  assert.equal(trophies.find((row) => row.trophy_type === 'golden_boot')?.nick_key, suspiciousPlayers[0].nick_key);

  const firstTrophy = await table(
    'game_player_achievements',
    `nick_key=eq.${encodeURIComponent(suspiciousPlayers[0].nick_key)}&achievement_code=eq.first_trophy&select=achievement_code`,
  );
  assert.equal(firstTrophy.length, 1);
  await rpc('set_game_player_featured_achievements', {
    p_nick_key: suspiciousPlayers[0].nick_key,
    p_achievement_codes: ['first_trophy'],
  });

  const suspiciousIds = [firstSuspiciousId];
  for (let index = 1; index < suspiciousPlayers.length; index += 1) {
    const id = await insertAttempt({
      participant: suspiciousPlayers[index],
      date: fraudDate,
      minute: 20 + index,
      difference: index,
      telemetry: automationTelemetry,
    });
    suspiciousIds.push(id);
    await rpc('reassess_game_integrity_cluster', { p_anchor_attempt_id: id });
  }

  await assertAttemptVerification(suspiciousIds, false);
  const integrityRows = await table(
    'game_attempt_integrity',
    `attempt_id=in.(${suspiciousIds.join(',')})&select=attempt_id,hard_valid,status,risk_score&order=attempt_id.asc`,
  );
  assert.equal(integrityRows.length, suspiciousIds.length);
  assert.ok(integrityRows.every((row) => row.hard_valid === true));
  assert.ok(integrityRows.every((row) => row.status === 'excluded'));
  assert.ok(integrityRows.every((row) => row.risk_score >= 65));

  trophies = await table(
    'game_daily_trophies',
    `award_date=eq.${fraudDate}&select=trophy_type,nick_key,metric_value&order=trophy_type.asc`,
  );
  assert.equal(trophies.find((row) => row.trophy_type === 'golden_boot')?.nick_key, fallback.nick_key);
  assert.equal(trophies.find((row) => row.trophy_type === 'golden_glove')?.nick_key, fallback.nick_key);
  assert.equal(trophies.find((row) => row.trophy_type === 'golden_ball')?.nick_key, fallback.nick_key);

  const oldAchievements = await table(
    'game_player_achievements',
    `nick_key=eq.${encodeURIComponent(suspiciousPlayers[0].nick_key)}&achievement_code=eq.first_trophy&select=achievement_code`,
  );
  assert.equal(oldAchievements.length, 0);
  const oldFeatured = await table(
    'game_player_featured_achievements',
    `nick_key=eq.${encodeURIComponent(suspiciousPlayers[0].nick_key)}&achievement_code=eq.first_trophy&select=active`,
  );
  assert.equal(oldFeatured[0]?.active, false);
  const newAchievements = await table(
    'game_player_achievements',
    `nick_key=eq.${encodeURIComponent(fallback.nick_key)}&achievement_code=eq.first_trophy&select=achievement_code`,
  );
  assert.equal(newAchievements.length, 1);
  logStep('Later corroborating evidence invalidates the suspicious history and reassigns trophies/achievements');

  const canonicalFraudAwards = await rpc('get_game_daily_awards_for_date', { p_award_date: fraudDate });
  assert.equal(canonicalFraudAwards.goldenBoot.nick, fallback.nick);
  assert.equal(canonicalFraudAwards.goldenGlove.nick, fallback.nick);
  assert.equal(canonicalFraudAwards.goldenBall.nick, fallback.nick);
  const secondReconcile = await rpc('reconcile_game_trophies_for_date', { p_award_date: fraudDate });
  assert.equal(secondReconcile, 3);
  const secondIntegrity = await rpc('reassess_game_integrity_cluster', {
    p_anchor_attempt_id: suspiciousIds.at(-1),
  });
  assert.equal(secondIntegrity.projectionChanges, 0);
  logStep('Date-based award calculation and integrity reconciliation are deterministic and idempotent');

  const today = madridDate(0);
  const currentAwards = await rpc('get_game_daily_awards');
  const sameDateAwards = await rpc('get_game_daily_awards_for_date', { p_award_date: today });
  assert.deepEqual(currentAwards, sameDateAwards);
  logStep('Current provisional awards delegate to the same canonical any-date backend calculation');

  const rawAttempts = await table(
    'game_attempts',
    `id=in.(${suspiciousIds.join(',')})&select=id,client_elapsed_ms,difference_ms,client_signals`,
  );
  assert.equal(rawAttempts.length, suspiciousIds.length);
  assert.ok(rawAttempts.every((attempt) => attempt.client_signals.pointerMoveCount === 0));
  const eventRows = await table(
    'game_attempt_integrity_events',
    `attempt_id=in.(${suspiciousIds.join(',')})&select=attempt_id,previous_status,next_status,next_score,policy_version`,
  );
  assert.ok(eventRows.length >= suspiciousIds.length);
  assert.ok(eventRows.every((event) => event.policy_version === 2));
  logStep('Raw attempt evidence remains intact while integrity decisions are append-only audited');

  // Ensure the honest fallback attempts themselves were never affected by the suspicious-device cluster.
  await assertAttemptVerification(fallbackIds, true);
}

await run();
