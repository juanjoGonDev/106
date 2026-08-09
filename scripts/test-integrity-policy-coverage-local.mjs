import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';

function readLocalDatabaseUrl() {
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
  const databaseUrl = values.DB_URL || values.POSTGRES_URL;
  if (!databaseUrl) throw new Error('Local Supabase database URL is unavailable.');
  return databaseUrl;
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'null';
  return `'${String(value).replaceAll("'", "''")}'`;
}

function runPsql(databaseUrl, sql) {
  const result = spawnSync('psql', [
    databaseUrl,
    '--no-psqlrc',
    '--tuples-only',
    '--no-align',
    '--set',
    'ON_ERROR_STOP=1',
    '--command',
    sql,
  ], { cwd: process.cwd(), encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`psql failed: ${result.stderr || result.stdout}\nSQL: ${sql}`);
  return result.stdout.trim();
}

function runPsqlExpectFailure(databaseUrl, sql, expectedPattern) {
  const result = spawnSync('psql', [
    databaseUrl,
    '--no-psqlrc',
    '--tuples-only',
    '--no-align',
    '--set',
    'ON_ERROR_STOP=1',
    '--command',
    sql,
  ], { cwd: process.cwd(), encoding: 'utf8' });
  if (result.error) throw result.error;
  assert.notEqual(result.status, 0, `Expected SQL failure but command succeeded: ${sql}`);
  assert.match(`${result.stderr}\n${result.stdout}`, expectedPattern);
}

function scalar(databaseUrl, expression) {
  const output = runPsql(databaseUrl, `select (${expression})::text;`);
  return output.split(/\r?\n/).filter(Boolean).at(-1) ?? '';
}

function jsonPsql(databaseUrl, expression) {
  return JSON.parse(scalar(databaseUrl, expression));
}

function boolPsql(databaseUrl, expression) {
  return scalar(databaseUrl, expression) === 'true';
}

function logStep(message) {
  process.stdout.write(`✓ ${message}\n`);
}

function policyDecision(databaseUrl, evidence = null) {
  const expression = evidence === null
    ? 'public.game_attempt_integrity_decision(null::jsonb)'
    : `public.game_attempt_integrity_decision(${sqlLiteral(JSON.stringify(evidence))}::jsonb)`;
  return jsonPsql(databaseUrl, expression);
}

function expectDecision(databaseUrl, name, evidence, expected) {
  const decision = policyDecision(databaseUrl, evidence);
  assert.equal(decision.policyVersion, 2, `${name}: policy version`);
  assert.equal(decision.status, expected.status, `${name}: status`);
  assert.equal(decision.riskScore, expected.score, `${name}: score`);
  if (expected.reasons) {
    assert.deepEqual(new Set(decision.reasons), new Set(expected.reasons), `${name}: reasons`);
  }
}

function randomHash() {
  return randomBytes(32).toString('hex');
}

function createAccountPlayer(databaseUrl, prefix, suffix, options = {}) {
  const nick = `${prefix}${suffix}`.replace(/[^A-Za-z0-9]/g, '').slice(0, 24);
  const nickKey = nick.toLocaleLowerCase('es');
  const deviceHash = options.deviceHash ?? randomHash();
  const ipHash = options.ipHash ?? randomHash();
  const tokenHash = options.tokenHash ?? randomHash();
  const created = jsonPsql(databaseUrl, `public.ensure_game_account_player(
    ${sqlLiteral(nick)},
    ${sqlLiteral(nickKey)},
    ${sqlLiteral(deviceHash)},
    ${sqlLiteral(ipHash)},
    ${sqlLiteral(tokenHash)},
    null
  )`);
  assert.equal(created.authorized, true, JSON.stringify(created));
  const accountId = scalar(
    databaseUrl,
    `(select account_id from public.game_account_players where nick_key = ${sqlLiteral(nickKey)})`,
  );
  assert.match(accountId, /^[0-9a-f-]{36}$/i);
  return { nick, nickKey, deviceHash, ipHash, tokenHash, accountId };
}

function insertAttempt(databaseUrl, participant, options = {}) {
  const attemptId = options.id ?? randomUUID();
  const challengeId = randomUUID();
  const createdAt = options.createdAt ?? new Date().toISOString();
  const difference = options.difference ?? 10;
  const verified = options.verified ?? true;
  const reasons = options.reasons ?? (verified ? [] : ['fixture_invalid']);
  const signals = options.signals ?? {};
  const leagueId = options.leagueId ?? null;
  const elapsed = 10_600 + Math.max(0, difference);
  const team = options.team ?? 'spain';
  const quotaDay = createdAt.slice(0, 10);

  runPsql(databaseUrl, `
    insert into public.game_challenges(
      id, nick, nick_key, team, device_hash, ip_hash, league_id,
      started_at, expires_at, consumed_at, quota_day
    ) values (
      ${sqlLiteral(challengeId)}::uuid,
      ${sqlLiteral(participant.nick)},
      ${sqlLiteral(participant.nickKey)},
      ${sqlLiteral(team)},
      ${sqlLiteral(participant.deviceHash)},
      ${sqlLiteral(participant.ipHash)},
      ${leagueId ? `${sqlLiteral(leagueId)}::uuid` : 'null'},
      ${sqlLiteral(createdAt)}::timestamptz,
      ${sqlLiteral(createdAt)}::timestamptz + interval '30 seconds',
      ${sqlLiteral(createdAt)}::timestamptz,
      ${sqlLiteral(quotaDay)}::date
    );

    insert into public.game_attempts(
      id, challenge_id, nick, nick_key, team, device_hash, ip_hash,
      client_elapsed_ms, server_elapsed_ms, difference_ms, verified,
      verification_reasons, client_signals, league_id, quota_day, created_at
    ) values (
      ${sqlLiteral(attemptId)}::uuid,
      ${sqlLiteral(challengeId)}::uuid,
      ${sqlLiteral(participant.nick)},
      ${sqlLiteral(participant.nickKey)},
      ${sqlLiteral(team)},
      ${sqlLiteral(participant.deviceHash)},
      ${sqlLiteral(participant.ipHash)},
      ${elapsed},
      ${elapsed},
      ${difference},
      ${verified ? 'true' : 'false'},
      array[${reasons.map(sqlLiteral).join(',')}]::text[],
      ${sqlLiteral(JSON.stringify(signals))}::jsonb,
      ${leagueId ? `${sqlLiteral(leagueId)}::uuid` : 'null'},
      ${sqlLiteral(quotaDay)}::date,
      ${sqlLiteral(createdAt)}::timestamptz
    );
  `);
  return attemptId;
}

function attemptProjection(databaseUrl, attemptId) {
  return jsonPsql(databaseUrl, `(
    select jsonb_build_object(
      'verified', attempt.verified,
      'differenceMs', attempt.difference_ms,
      'clientElapsedMs', attempt.client_elapsed_ms,
      'serverElapsedMs', attempt.server_elapsed_ms,
      'signals', attempt.client_signals,
      'status', integrity.status,
      'hardValid', integrity.hard_valid,
      'riskScore', integrity.risk_score,
      'policyVersion', integrity.policy_version
    )
    from public.game_attempts attempt
    join public.game_attempt_integrity integrity on integrity.attempt_id = attempt.id
    where attempt.id = ${sqlLiteral(attemptId)}::uuid
  )`);
}

function madridDay(databaseUrl, offsetDays) {
  return scalar(
    databaseUrl,
    `(public.game_server_day(clock_timestamp()) + (${Number(offsetDays)})::integer)::text`,
  );
}

function isoAt(day, hour, minute = 0, second = 0) {
  return `${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}Z`;
}

async function holdAdvisoryTransaction(databaseUrl, lockExpression) {
  const child = spawn('psql', [
    databaseUrl,
    '--no-psqlrc',
    '--tuples-only',
    '--no-align',
    '--set',
    'ON_ERROR_STOP=1',
  ], { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] });

  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  const ready = new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error(`Timed out acquiring fixture lock: ${stdout}\n${stderr}`)), 5_000);
    const inspect = () => {
      if (stdout.includes('INTEGRITY_TEST_LOCKED')) {
        clearTimeout(deadline);
        resolve();
      }
    };
    child.stdout.on('data', inspect);
    child.once('exit', (code) => {
      if (!stdout.includes('INTEGRITY_TEST_LOCKED')) {
        clearTimeout(deadline);
        reject(new Error(`Fixture lock session exited (${code}): ${stdout}\n${stderr}`));
      }
    });
  });

  child.stdin.write(`begin;\nselect pg_advisory_xact_lock(${lockExpression});\nselect 'INTEGRITY_TEST_LOCKED';\n`);
  await ready;

  return async () => {
    child.stdin.write('rollback;\n\\q\n');
    await new Promise((resolve, reject) => {
      child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Lock session exit ${code}: ${stderr}`)));
    });
  };
}

function testPolicyMatrix(databaseUrl) {
  expectDecision(databaseUrl, 'null evidence', null, { status: 'eligible', score: 0, reasons: [] });
  expectDecision(databaseUrl, 'negative values clamp to zero', {
    sameDeviceNearPerfect: -9,
    distinctDeviceNicks: -9,
    distinctDeviceAccounts: -9,
    sameAccountNicks: -9,
    sameIpNearPerfect: -9,
    sameIpDevices: -9,
    fingerprintMatches: -9,
    automationShapeMatches: -9,
  }, { status: 'eligible', score: 0, reasons: [] });

  for (const [value, score] of [[2, 0], [3, 10], [4, 20], [5, 20], [6, 25], [7, 25], [8, 30]]) {
    expectDecision(databaseUrl, `near-perfect branch ${value}`, { sameDeviceNearPerfect: value }, {
      status: 'eligible', score, reasons: value >= 3 ? ['near_perfect_frequency'] : [],
    });
  }
  for (const [value, score] of [[1, 0], [2, 10], [3, 25], [4, 30]]) {
    expectDecision(databaseUrl, `same-device nick branch ${value}`, { distinctDeviceNicks: value }, {
      status: 'eligible', score, reasons: value >= 2 ? ['cross_nick_same_device'] : [],
    });
  }
  for (const [value, score] of [[1, 0], [2, 10], [3, 20], [4, 25]]) {
    expectDecision(databaseUrl, `fingerprint branch ${value}`, { fingerprintMatches: value }, {
      status: 'eligible', score, reasons: value >= 2 ? ['repeated_interaction_pattern'] : [],
    });
  }
  for (const [value, score] of [[2, 0], [3, 15], [4, 30]]) {
    expectDecision(databaseUrl, `automation-shape branch ${value}`, { automationShapeMatches: value }, {
      status: 'eligible', score, reasons: value >= 3 ? ['repeated_zero_motion_activation_gap'] : [],
    });
  }

  expectDecision(databaseUrl, 'distinct-account identity context', { distinctDeviceAccounts: 2 }, {
    status: 'eligible', score: 5, reasons: ['multi_identity_context'],
  });
  expectDecision(databaseUrl, 'same-account multi-nick context', { sameAccountNicks: 3 }, {
    status: 'eligible', score: 5, reasons: ['multi_identity_context'],
  });
  expectDecision(databaseUrl, 'identity OR does not double-count', {
    distinctDeviceAccounts: 2, sameAccountNicks: 3,
  }, { status: 'eligible', score: 5, reasons: ['multi_identity_context'] });
  expectDecision(databaseUrl, 'IP below near threshold', { sameIpNearPerfect: 5, sameIpDevices: 9 }, {
    status: 'eligible', score: 0, reasons: [],
  });
  expectDecision(databaseUrl, 'IP below device threshold', { sameIpNearPerfect: 99, sameIpDevices: 2 }, {
    status: 'eligible', score: 0, reasons: [],
  });
  expectDecision(databaseUrl, 'IP correlation is capped weak context', { sameIpNearPerfect: 6, sameIpDevices: 3 }, {
    status: 'eligible', score: 5, reasons: ['shared_ip_context'],
  });

  expectDecision(databaseUrl, 'exact watch threshold', {
    sameDeviceNearPerfect: 3,
    distinctDeviceNicks: 2,
    fingerprintMatches: 2,
    sameIpNearPerfect: 6,
    sameIpDevices: 3,
  }, {
    status: 'watch', score: 35,
    reasons: ['near_perfect_frequency', 'cross_nick_same_device', 'repeated_interaction_pattern', 'shared_ip_context'],
  });
  expectDecision(databaseUrl, 'score cannot bypass near-perfect gate', {
    sameDeviceNearPerfect: 3,
    distinctDeviceNicks: 4,
    fingerprintMatches: 4,
    automationShapeMatches: 4,
  }, { status: 'watch', score: 95 });
  expectDecision(databaseUrl, 'score cannot bypass fingerprint gate', {
    sameDeviceNearPerfect: 8,
    distinctDeviceNicks: 4,
    fingerprintMatches: 2,
    automationShapeMatches: 4,
  }, { status: 'watch', score: 100 });
  expectDecision(databaseUrl, 'score cannot bypass strong-identity/activation gate', {
    sameDeviceNearPerfect: 8,
    distinctDeviceNicks: 1,
    distinctDeviceAccounts: 2,
    fingerprintMatches: 4,
    sameIpNearPerfect: 6,
    sameIpDevices: 3,
  }, { status: 'watch', score: 65 });
  expectDecision(databaseUrl, 'minimal cross-nick exclusion boundary', {
    sameDeviceNearPerfect: 4,
    distinctDeviceNicks: 3,
    fingerprintMatches: 3,
  }, { status: 'excluded', score: 65 });
  expectDecision(databaseUrl, 'activation-gap alternative exclusion', {
    sameDeviceNearPerfect: 4,
    distinctDeviceNicks: 2,
    fingerprintMatches: 3,
    automationShapeMatches: 4,
  }, { status: 'excluded', score: 80 });
  expectDecision(databaseUrl, 'risk score is capped at 100', {
    sameDeviceNearPerfect: 99,
    distinctDeviceNicks: 99,
    distinctDeviceAccounts: 99,
    sameAccountNicks: 99,
    sameIpNearPerfect: 99,
    sameIpDevices: 99,
    fingerprintMatches: 99,
    automationShapeMatches: 99,
  }, { status: 'excluded', score: 100 });

  logStep('policy-v2 scoring, every threshold branch, gate, weak-IP rule, watch boundary and score cap are covered');
}

function testHardValidityAndTelemetry(databaseUrl) {
  const hardCases = [
    ['verified with null reasons', 'public.game_attempt_hard_valid(true, null)', true],
    ['verified with hard reason remains hard-valid source truth', "public.game_attempt_hard_valid(true, array['timing_mismatch'])", true],
    ['false null reasons', 'public.game_attempt_hard_valid(false, null)', false],
    ['false empty reasons', "public.game_attempt_hard_valid(false, '{}'::text[])", false],
    ['legacy precision heuristic', "public.game_attempt_hard_valid(false, array['repeated_near_perfect_results'])", true],
    ['legacy fingerprint heuristic', "public.game_attempt_hard_valid(false, array['repeated_interaction_fingerprint'])", true],
    ['both legacy heuristics', "public.game_attempt_hard_valid(false, array['repeated_near_perfect_results','repeated_interaction_fingerprint'])", true],
    ['hard timing failure', "public.game_attempt_hard_valid(false, array['timing_mismatch'])", false],
    ['mixed heuristic and hard failure', "public.game_attempt_hard_valid(false, array['repeated_near_perfect_results','device_mismatch'])", false],
    ['null verified with reassessable heuristic', "public.game_attempt_hard_valid(null, array['repeated_interaction_fingerprint'])", true],
  ];
  for (const [name, expression, expected] of hardCases) {
    assert.equal(boolPsql(databaseUrl, expression), expected, name);
  }

  assert.deepEqual(jsonPsql(databaseUrl, 'public.game_attempt_client_telemetry(null::jsonb)'), {});
  assert.deepEqual(jsonPsql(databaseUrl, "public.game_attempt_client_telemetry('[]'::jsonb)"), {});
  assert.deepEqual(jsonPsql(databaseUrl, "public.game_attempt_client_telemetry('{\"pointerType\":\"mouse\"}'::jsonb)"), { pointerType: 'mouse' });
  assert.deepEqual(
    jsonPsql(databaseUrl, "public.game_attempt_client_telemetry('{\"clientTelemetry\":{\"pointerType\":\"touch\"},\"pointerType\":\"mouse\"}'::jsonb)"),
    { pointerType: 'touch' },
  );

  assert.equal(scalar(databaseUrl, "public.game_attempt_interaction_fingerprint('{}'::jsonb)"), '');
  assert.equal(scalar(databaseUrl, "public.game_attempt_interaction_fingerprint('{\"pointerType\":\"mouse\"}'::jsonb)"), '');
  assert.equal(scalar(databaseUrl, "public.game_attempt_interaction_fingerprint('{\"pointerType\":\"mouse\",\"pointerMoveCount\":1,\"automaticFinish\":true}'::jsonb)"), '');

  const telemetry = {
    finishEvent: 'pointerdown', pointerType: 'mouse', pointerMoveCount: 3,
    pointerTravelPx: 40, pointerDwellMs: 20, pressureMax: 0,
    userActivation: true, automationDetected: false,
  };
  const rootFingerprint = scalar(
    databaseUrl,
    `public.game_attempt_interaction_fingerprint(${sqlLiteral(JSON.stringify(telemetry))}::jsonb)`,
  );
  const nestedFingerprint = scalar(
    databaseUrl,
    `public.game_attempt_interaction_fingerprint(${sqlLiteral(JSON.stringify({ clientTelemetry: telemetry, ignored: randomUUID() }))}::jsonb)`,
  );
  assert.ok(rootFingerprint);
  assert.equal(nestedFingerprint, rootFingerprint);
  const irrelevantFingerprint = scalar(
    databaseUrl,
    `public.game_attempt_interaction_fingerprint(${sqlLiteral(JSON.stringify({ ...telemetry, unrelated: 'ignored' }))}::jsonb)`,
  );
  assert.equal(irrelevantFingerprint, rootFingerprint);
  const changedFingerprint = scalar(
    databaseUrl,
    `public.game_attempt_interaction_fingerprint(${sqlLiteral(JSON.stringify({ ...telemetry, pointerMoveCount: 4 }))}::jsonb)`,
  );
  assert.notEqual(changedFingerprint, rootFingerprint);

  logStep('hard-valid classification and telemetry/fingerprint normalization cover null, malformed, legacy and hard-failure edges');
}

function testEvidenceWindow(databaseUrl, prefix) {
  const day = madridDay(databaseUrl, -25);
  const deviceHash = randomHash();
  const ipHash = randomHash();
  const participant = createAccountPlayer(databaseUrl, prefix, 'Window', { deviceHash, ipHash });
  const signals = {
    pointerType: 'mouse', pointerMoveCount: 2, pointerTravelPx: 18,
    pointerDwellMs: 9, finishEvent: 'pointerdown', userActivation: true,
    automationDetected: false,
  };
  const anchorAt = isoAt(day, 12);
  insertAttempt(databaseUrl, participant, { difference: 2, createdAt: `${day}T11:59:59.999Z`, signals });
  const anchorId = insertAttempt(databaseUrl, participant, { difference: 1, createdAt: anchorAt, signals });

  const exactBoundary = new Date(Date.parse(anchorAt) - 86_400_000).toISOString();
  const outsideBoundary = new Date(Date.parse(anchorAt) - 86_400_001).toISOString();
  insertAttempt(databaseUrl, participant, { difference: 3, createdAt: exactBoundary, signals });
  insertAttempt(databaseUrl, participant, { difference: 3, createdAt: outsideBoundary, signals });
  insertAttempt(databaseUrl, participant, { difference: 3, createdAt: new Date(Date.parse(anchorAt) + 1).toISOString(), signals });
  insertAttempt(databaseUrl, participant, {
    difference: 0,
    createdAt: new Date(Date.parse(anchorAt) - 10_000).toISOString(),
    verified: false,
    reasons: ['timing_mismatch'],
    signals,
  });

  const evidence = jsonPsql(databaseUrl, `public.game_attempt_integrity_evidence(${sqlLiteral(anchorId)}::uuid)`);
  assert.equal(evidence.anchorAttemptId, anchorId);
  assert.equal(evidence.sameDeviceNearPerfect, 3);
  assert.equal(evidence.distinctDeviceNicks, 1);
  assert.equal(evidence.distinctDeviceAccounts, 1);
  assert.equal(evidence.sameAccountNicks, 1);
  assert.equal(evidence.sameIpNearPerfect, 3);
  assert.equal(evidence.sameIpDevices, 1);
  assert.equal(evidence.fingerprintMatches, 3);
  assert.equal(evidence.automationShapeMatches, 0);
  assert.equal(evidence.fingerprintAvailable, true);
  assert.equal(
    jsonPsql(databaseUrl, `public.game_attempt_integrity_evidence(${sqlLiteral(randomUUID())}::uuid)`).error,
    'attempt_not_found',
  );

  logStep('evidence includes the exact 24-hour boundary and excludes older, future and hard-invalid attempts');
  return anchorId;
}

function testReassessmentTransitions(databaseUrl, prefix) {
  const day = madridDay(databaseUrl, -20);
  const legacy = createAccountPlayer(databaseUrl, prefix, 'Legacy');
  const legacyId = insertAttempt(databaseUrl, legacy, {
    difference: 9,
    createdAt: isoAt(day, 9),
    verified: false,
    reasons: ['repeated_near_perfect_results'],
  });
  const restored = jsonPsql(databaseUrl, `public.reassess_game_integrity_cluster(${sqlLiteral(legacyId)}::uuid)`);
  assert.equal(restored.hardValid, true);
  assert.equal(restored.status, 'eligible');
  assert.equal(restored.projectionChanges, 1);
  assert.equal(attemptProjection(databaseUrl, legacyId).verified, true);

  const hardInvalid = createAccountPlayer(databaseUrl, prefix, 'HardInvalid');
  const hardInvalidId = insertAttempt(databaseUrl, hardInvalid, {
    difference: 9,
    createdAt: isoAt(day, 10),
    verified: false,
    reasons: ['timing_mismatch'],
  });
  runPsql(databaseUrl, `update public.game_attempts set verified = true where id = ${sqlLiteral(hardInvalidId)}::uuid;`);
  const repaired = jsonPsql(databaseUrl, `public.reassess_game_integrity_cluster(${sqlLiteral(hardInvalidId)}::uuid)`);
  assert.equal(repaired.hardValid, false);
  assert.equal(repaired.status, 'excluded');
  assert.equal(repaired.projectionChanges, 1);
  assert.equal(attemptProjection(databaseUrl, hardInvalidId).verified, false);

  const normal = createAccountPlayer(databaseUrl, prefix, 'Normal');
  const normalId = insertAttempt(databaseUrl, normal, { difference: 6, createdAt: isoAt(day, 11) });
  const normalResult = jsonPsql(databaseUrl, `public.reassess_game_integrity_cluster(${sqlLiteral(normalId)}::uuid)`);
  assert.equal(normalResult.status, 'eligible');
  assert.equal(normalResult.riskScore, 0);
  assert.equal(normalResult.projectionChanges, 0);
  assert.equal(
    jsonPsql(databaseUrl, `public.reassess_game_integrity_cluster(${sqlLiteral(randomUUID())}::uuid)`).error,
    'attempt_not_found',
  );

  const sharedDevice = randomHash();
  const signals = {
    finishEvent: 'pointerdown', pointerType: 'mouse', pointerMoveCount: 2,
    pointerTravelPx: 24, pointerDwellMs: 12, userActivation: true,
    automationDetected: false,
  };
  const a = createAccountPlayer(databaseUrl, prefix, 'ClusterA', { deviceHash: sharedDevice });
  const b = createAccountPlayer(databaseUrl, prefix, 'ClusterB', { deviceHash: sharedDevice });
  const c = createAccountPlayer(databaseUrl, prefix, 'ClusterC', { deviceHash: sharedDevice });
  const ids = [
    insertAttempt(databaseUrl, a, { difference: 1, createdAt: isoAt(day, 13, 0), signals }),
    insertAttempt(databaseUrl, b, { difference: 2, createdAt: isoAt(day, 13, 1), signals }),
    insertAttempt(databaseUrl, a, { difference: 3, createdAt: isoAt(day, 13, 2), signals }),
  ];
  const watch = jsonPsql(databaseUrl, `public.reassess_game_integrity_cluster(${sqlLiteral(ids.at(-1))}::uuid)`);
  assert.equal(watch.status, 'watch');
  for (const id of ids) {
    const state = attemptProjection(databaseUrl, id);
    assert.equal(state.status, 'watch');
    assert.equal(state.verified, true);
  }

  const fourthId = insertAttempt(databaseUrl, c, { difference: 4, createdAt: isoAt(day, 13, 3), signals });
  ids.push(fourthId);
  const excluded = jsonPsql(databaseUrl, `public.reassess_game_integrity_cluster(${sqlLiteral(fourthId)}::uuid)`);
  assert.equal(excluded.status, 'excluded');
  assert.equal(excluded.projectionChanges, 4);
  for (const id of ids) {
    const state = attemptProjection(databaseUrl, id);
    assert.equal(state.status, 'excluded');
    assert.equal(state.verified, false);
  }

  const eventCountBefore = Number(scalar(databaseUrl, `(
    select count(*) from public.game_attempt_integrity_events where attempt_id = any(array[${ids.map((id) => `${sqlLiteral(id)}::uuid`).join(',')}])
  )`));
  const repeated = jsonPsql(databaseUrl, `public.reassess_game_integrity_cluster(${sqlLiteral(fourthId)}::uuid)`);
  assert.equal(repeated.stateChanges, 0);
  assert.equal(repeated.projectionChanges, 0);
  const eventCountAfter = Number(scalar(databaseUrl, `(
    select count(*) from public.game_attempt_integrity_events where attempt_id = any(array[${ids.map((id) => `${sqlLiteral(id)}::uuid`).join(',')}])
  )`));
  assert.equal(eventCountAfter, eventCountBefore);

  logStep('reassessment covers missing/non-near anchors, legacy restoration, hard repair, watch propagation, exclusion and idempotency');
  return { ids, anchorId: fourthId, deviceHash: sharedDevice, rawReferenceId: ids[0] };
}

function testDailyNoSuccessor(databaseUrl, prefix) {
  const day = madridDay(databaseUrl, -15);
  const participant = createAccountPlayer(databaseUrl, prefix, 'SoloAward');
  const attemptId = insertAttempt(databaseUrl, participant, { difference: 10, createdAt: isoAt(day, 12) });

  assert.equal(Number(scalar(databaseUrl, `public.reconcile_game_trophies_for_date(${sqlLiteral(day)}::date)`)), 2);
  const trophiesBefore = jsonPsql(databaseUrl, `(
    select coalesce(jsonb_agg(jsonb_build_object('type', trophy_type, 'nickKey', nick_key, 'awardedAt', awarded_at) order by trophy_type), '[]'::jsonb)
    from public.game_daily_trophies where award_date = ${sqlLiteral(day)}::date
  )`);
  assert.deepEqual(trophiesBefore.map((row) => row.type), ['golden_ball', 'golden_boot']);
  assert.ok(trophiesBefore.every((row) => row.nickKey === participant.nickKey));

  assert.equal(Number(scalar(databaseUrl, `public.reconcile_game_trophies_for_date(${sqlLiteral(day)}::date)`)), 2);
  const awardedAfterRepeat = jsonPsql(databaseUrl, `(
    select coalesce(jsonb_agg(awarded_at order by trophy_type), '[]'::jsonb)
    from public.game_daily_trophies where award_date = ${sqlLiteral(day)}::date
  )`);
  assert.deepEqual(awardedAfterRepeat, trophiesBefore.map((row) => row.awardedAt));

  runPsql(databaseUrl, `
    update public.game_attempt_integrity
    set hard_valid = false, status = 'excluded', risk_score = 100, risk_reasons = array['fixture_invalidated']
    where attempt_id = ${sqlLiteral(attemptId)}::uuid;
    update public.game_attempts set verified = false where id = ${sqlLiteral(attemptId)}::uuid;
  `);
  assert.equal(Number(scalar(databaseUrl, `public.reconcile_game_trophies_for_date(${sqlLiteral(day)}::date)`)), 0);
  assert.equal(Number(scalar(databaseUrl, `(select count(*) from public.game_daily_trophies where award_date = ${sqlLiteral(day)}::date)`)), 0);
  assert.equal(Number(scalar(databaseUrl, `(
    select trophy_count from public.game_trophy_award_runs where award_date = ${sqlLiteral(day)}::date
  )`)), 0);
  assert.equal(Number(scalar(databaseUrl, `(
    select count(*) from public.game_player_achievements
    where nick_key = ${sqlLiteral(participant.nickKey)} and achievement_code = 'first_trophy'
  )`)), 0);

  const emptyAwards = jsonPsql(databaseUrl, `public.get_game_daily_awards_for_date(${sqlLiteral(day)}::date)`);
  assert.equal(emptyAwards.date, day);
  assert.equal(emptyAwards.goldenBoot, null);
  assert.equal(emptyAwards.goldenGlove, null);
  assert.equal(emptyAwards.goldenBall, null);
  assert.equal(Number(scalar(databaseUrl, 'public.reconcile_game_trophies_for_date(null::date)')), 0);
  assert.equal(Number(scalar(databaseUrl, 'public.reconcile_game_trophies_for_date(public.game_server_day(clock_timestamp()))')), 0);
  assert.equal(Number(scalar(databaseUrl, 'public.reconcile_game_trophies_for_date(public.game_server_day(clock_timestamp()) + 1)')), 0);

  logStep('daily reward reconciliation covers unchanged timestamps, no-successor removal, empty dates and closed-day guards');
}

function testReferralReconciliation(databaseUrl, prefix) {
  const referrer = createAccountPlayer(databaseUrl, prefix, 'Referrer');
  const referred = createAccountPlayer(databaseUrl, prefix, 'Referred');
  const referralCode = scalar(databaseUrl, `(
    select referral_code from public.game_players where nick_key = ${sqlLiteral(referrer.nickKey)}
  )`);
  assert.match(referralCode, /^[0-9a-f-]{36}$/i);
  const registered = jsonPsql(databaseUrl, `public.register_game_account_referral(
    ${sqlLiteral(referralCode)}::uuid,
    ${sqlLiteral(referred.nickKey)},
    ${sqlLiteral(referred.deviceHash)},
    ${sqlLiteral(referred.ipHash)}
  )`);
  assert.equal(registered.registered, true, JSON.stringify(registered));

  const day = madridDay(databaseUrl, -10);
  const attemptIds = [];
  for (let index = 0; index < 5; index += 1) {
    attemptIds.push(insertAttempt(databaseUrl, referred, {
      difference: 10 + index,
      createdAt: isoAt(day, 9, index),
    }));
  }
  const fifthAt = isoAt(day, 9, 4);
  assert.equal(boolPsql(databaseUrl, `public.reconcile_game_account_referral(${sqlLiteral(referred.accountId)}::uuid)`), true);
  assert.equal(
    Date.parse(scalar(databaseUrl, `(
      select completed_at from public.game_referrals where referred_nick_key = ${sqlLiteral(referred.nickKey)}
    )`)),
    Date.parse(fifthAt),
  );
  assert.equal(boolPsql(databaseUrl, `public.reconcile_game_account_referral(${sqlLiteral(referred.accountId)}::uuid)`), false);

  const invalidatedId = attemptIds[1];
  runPsql(databaseUrl, `
    update public.game_attempt_integrity set hard_valid = false, status = 'excluded', risk_score = 100
    where attempt_id = ${sqlLiteral(invalidatedId)}::uuid;
    update public.game_attempts set verified = false where id = ${sqlLiteral(invalidatedId)}::uuid;
  `);
  assert.equal(boolPsql(databaseUrl, `public.reconcile_game_account_referral(${sqlLiteral(referred.accountId)}::uuid)`), true);
  assert.equal(scalar(databaseUrl, `(
    select coalesce(completed_at::text, '') from public.game_referrals where referred_nick_key = ${sqlLiteral(referred.nickKey)}
  )`), '');

  const sixthAt = isoAt(day, 9, 5);
  insertAttempt(databaseUrl, referred, { difference: 20, createdAt: sixthAt });
  assert.equal(boolPsql(databaseUrl, `public.reconcile_game_account_referral(${sqlLiteral(referred.accountId)}::uuid)`), true);
  assert.equal(
    Date.parse(scalar(databaseUrl, `(
      select completed_at from public.game_referrals where referred_nick_key = ${sqlLiteral(referred.nickKey)}
    )`)),
    Date.parse(sixthAt),
  );

  runPsql(databaseUrl, `
    update public.game_attempt_integrity set hard_valid = true, status = 'eligible', risk_score = 0, risk_reasons = '{}'::text[]
    where attempt_id = ${sqlLiteral(invalidatedId)}::uuid;
    update public.game_attempts set verified = true where id = ${sqlLiteral(invalidatedId)}::uuid;
  `);
  assert.equal(boolPsql(databaseUrl, `public.reconcile_game_account_referral(${sqlLiteral(referred.accountId)}::uuid)`), true);
  assert.equal(
    Date.parse(scalar(databaseUrl, `(
      select completed_at from public.game_referrals where referred_nick_key = ${sqlLiteral(referred.nickKey)}
    )`)),
    Date.parse(fifthAt),
  );
  assert.ok(Number(scalar(databaseUrl, `public.game_account_referral_bonus(${sqlLiteral(referrer.accountId)}::uuid)`)) >= 1);

  logStep('referrals reopen below five verified attempts and deterministically follow the current fifth attempt when history changes');
  return referred.accountId;
}

function testLeagueReconciliation(databaseUrl, prefix) {
  const owner = createAccountPlayer(databaseUrl, prefix, 'LeagueOwner');
  const second = createAccountPlayer(databaseUrl, prefix, 'LeagueSecond');
  const third = createAccountPlayer(databaseUrl, prefix, 'LeagueThird');
  const created = jsonPsql(databaseUrl, `public.create_game_league(
    ${sqlLiteral(`Coverage ${prefix}`)},
    ${sqlLiteral(owner.nickKey)},
    ${sqlLiteral(owner.deviceHash)}
  )`);
  assert.equal(created.waiting, true, JSON.stringify(created));
  assert.equal(Number(scalar(databaseUrl, `public.reconcile_game_league_trophy((select id from public.game_leagues where code = ${sqlLiteral(created.code)}))`)), 0);

  const joinedSecond = jsonPsql(databaseUrl, `public.join_game_league(${sqlLiteral(created.code)}, ${sqlLiteral(second.nickKey)}, ${sqlLiteral(second.deviceHash)})`);
  assert.equal(joinedSecond.waiting, true, JSON.stringify(joinedSecond));
  const joinedThird = jsonPsql(databaseUrl, `public.join_game_league(${sqlLiteral(created.code)}, ${sqlLiteral(third.nickKey)}, ${sqlLiteral(third.deviceHash)})`);
  assert.equal(joinedThird.active, true, JSON.stringify(joinedThird));
  assert.equal(joinedThird.eligible, true, JSON.stringify(joinedThird));

  const leagueId = scalar(databaseUrl, `(select id from public.game_leagues where code = ${sqlLiteral(created.code)})`);
  assert.equal(Number(scalar(databaseUrl, `public.reconcile_game_league_trophy(${sqlLiteral(leagueId)}::uuid)`)), 0);

  const day = madridDay(databaseUrl, -5);
  const ownerAttempt = insertAttempt(databaseUrl, owner, { difference: 10, createdAt: isoAt(day, 12, 0), leagueId });
  const secondAttempt = insertAttempt(databaseUrl, second, { difference: 20, createdAt: isoAt(day, 12, 1), leagueId });
  const thirdAttempt = insertAttempt(databaseUrl, third, { difference: 30, createdAt: isoAt(day, 12, 2), leagueId });
  runPsql(databaseUrl, `update public.game_leagues set ends_at = clock_timestamp() - interval '1 second' where id = ${sqlLiteral(leagueId)}::uuid;`);

  assert.equal(Number(scalar(databaseUrl, `public.reconcile_game_league_trophy(${sqlLiteral(leagueId)}::uuid)`)), 1);
  assert.equal(scalar(databaseUrl, `(
    select winning_attempt_id from public.game_league_trophies where league_id = ${sqlLiteral(leagueId)}::uuid
  )`), ownerAttempt);
  assert.equal(Number(scalar(databaseUrl, `public.reconcile_game_league_trophy(${sqlLiteral(leagueId)}::uuid)`)), 0);

  runPsql(databaseUrl, `
    update public.game_attempt_integrity set hard_valid = false, status = 'excluded', risk_score = 100
    where attempt_id = ${sqlLiteral(ownerAttempt)}::uuid;
    update public.game_attempts set verified = false where id = ${sqlLiteral(ownerAttempt)}::uuid;
  `);
  assert.equal(Number(scalar(databaseUrl, `public.reconcile_game_league_trophy(${sqlLiteral(leagueId)}::uuid)`)), 1);
  assert.equal(scalar(databaseUrl, `(
    select winning_attempt_id from public.game_league_trophies where league_id = ${sqlLiteral(leagueId)}::uuid
  )`), secondAttempt);

  for (const attemptId of [secondAttempt, thirdAttempt]) {
    runPsql(databaseUrl, `
      update public.game_attempt_integrity set hard_valid = false, status = 'excluded', risk_score = 100
      where attempt_id = ${sqlLiteral(attemptId)}::uuid;
      update public.game_attempts set verified = false where id = ${sqlLiteral(attemptId)}::uuid;
    `);
  }
  assert.equal(Number(scalar(databaseUrl, `public.reconcile_game_league_trophy(${sqlLiteral(leagueId)}::uuid)`)), 1);
  assert.equal(Number(scalar(databaseUrl, `(select count(*) from public.game_league_trophies where league_id = ${sqlLiteral(leagueId)}::uuid)`)), 0);
  assert.equal(Number(scalar(databaseUrl, `public.reconcile_game_league_trophy(${sqlLiteral(randomUUID())}::uuid)`)), 0);
  assert.equal(Number(scalar(databaseUrl, 'public.sync_game_league_trophies()')), 0);

  logStep('league reconciliation covers waiting/active guards, initial champion, idempotency, successor reassignment and no-winner removal');
}

async function testAdvisoryLockSerialization(databaseUrl, cluster, referralAccountId) {
  const releaseDevice = await holdAdvisoryTransaction(
    databaseUrl,
    `hashtextextended(${sqlLiteral(`integrity-device:${cluster.deviceHash}`)}, 106)`,
  );
  try {
    runPsqlExpectFailure(databaseUrl, `
      set lock_timeout = '250ms';
      select public.reassess_game_integrity_cluster(${sqlLiteral(cluster.anchorId)}::uuid);
    `, /lock timeout|canceling statement due to lock timeout/i);
  } finally {
    await releaseDevice();
  }

  const canonicalAccount = scalar(databaseUrl, `public.daily_game_account_id(${sqlLiteral(referralAccountId)}::uuid)`);
  const releaseReferral = await holdAdvisoryTransaction(
    databaseUrl,
    `hashtextextended(${sqlLiteral(`referral-complete:${canonicalAccount}`)}, 106)`,
  );
  try {
    runPsqlExpectFailure(databaseUrl, `
      set lock_timeout = '250ms';
      select public.reconcile_game_account_referral(${sqlLiteral(referralAccountId)}::uuid);
    `, /lock timeout|canceling statement due to lock timeout/i);
  } finally {
    await releaseReferral();
  }

  logStep('runtime lock contention proves same-device reassessment and referral correction serialize on their canonical advisory keys');
}

function testAuditPrivileges(databaseUrl, attemptId) {
  assert.equal(boolPsql(databaseUrl, "has_table_privilege('service_role', 'public.game_attempt_integrity_events', 'SELECT')"), true);
  assert.equal(boolPsql(databaseUrl, "has_table_privilege('service_role', 'public.game_attempt_integrity_events', 'INSERT')"), true);
  assert.equal(boolPsql(databaseUrl, "has_table_privilege('service_role', 'public.game_attempt_integrity_events', 'UPDATE')"), false);
  assert.equal(boolPsql(databaseUrl, "has_table_privilege('service_role', 'public.game_attempt_integrity_events', 'DELETE')"), false);
  assert.equal(boolPsql(databaseUrl, "has_table_privilege('anon', 'public.game_attempt_integrity_events', 'SELECT')"), false);
  assert.equal(boolPsql(databaseUrl, "has_table_privilege('authenticated', 'public.game_attempt_integrity_events', 'SELECT')"), false);
  assert.equal(boolPsql(databaseUrl, "has_function_privilege('anon', 'public.reassess_game_integrity_cluster(uuid)', 'EXECUTE')"), false);
  assert.equal(boolPsql(databaseUrl, "has_function_privilege('authenticated', 'public.reassess_game_integrity_cluster(uuid)', 'EXECUTE')"), false);

  const eventId = scalar(databaseUrl, `(
    select id from public.game_attempt_integrity_events where attempt_id = ${sqlLiteral(attemptId)}::uuid order by id desc limit 1
  )`);
  assert.ok(eventId);
  runPsqlExpectFailure(databaseUrl, `
    set role service_role;
    update public.game_attempt_integrity_events set next_score = next_score where id = ${Number(eventId)};
  `, /permission denied/i);

  logStep('integrity state remains private and the audit ledger is append-only for service/API roles');
}

function testFullRebuild(databaseUrl, cluster) {
  const rawBefore = attemptProjection(databaseUrl, cluster.rawReferenceId);
  assert.equal(rawBefore.status, 'excluded');
  assert.equal(rawBefore.verified, false);

  const forced = jsonPsql(databaseUrl, 'public.rebuild_game_attempt_integrity(true)');
  assert.equal(forced.policyVersion, 2);
  assert.equal(forced.alreadyCurrent, false);
  assert.ok(forced.reassessed >= 1);
  assert.ok(forced.verifiedChanges >= cluster.ids.length * 2, JSON.stringify(forced));

  const rawAfter = attemptProjection(databaseUrl, cluster.rawReferenceId);
  assert.equal(rawAfter.status, 'excluded');
  assert.equal(rawAfter.verified, false);
  assert.equal(rawAfter.differenceMs, rawBefore.differenceMs);
  assert.equal(rawAfter.clientElapsedMs, rawBefore.clientElapsedMs);
  assert.equal(rawAfter.serverElapsedMs, rawBefore.serverElapsedMs);
  assert.deepEqual(rawAfter.signals, rawBefore.signals);

  const current = jsonPsql(databaseUrl, 'public.rebuild_game_attempt_integrity(false)');
  assert.equal(current.policyVersion, 2);
  assert.equal(current.alreadyCurrent, true);
  assert.equal(current.reassessed, 0);
  assert.equal(current.verifiedChanges, 0);

  logStep('forced rebuild reports reset plus re-exclusion projection writes, preserves raw evidence and no-ops when policy is current');
}

const databaseUrl = readLocalDatabaseUrl();
const prefix = `I${Date.now().toString(36).slice(-6)}`;

testPolicyMatrix(databaseUrl);
testHardValidityAndTelemetry(databaseUrl);
testEvidenceWindow(databaseUrl, prefix);
const cluster = testReassessmentTransitions(databaseUrl, prefix);
testDailyNoSuccessor(databaseUrl, prefix);
const referralAccountId = testReferralReconciliation(databaseUrl, prefix);
testLeagueReconciliation(databaseUrl, prefix);
await testAdvisoryLockSerialization(databaseUrl, cluster, referralAccountId);
testAuditPrivileges(databaseUrl, cluster.anchorId);
testFullRebuild(databaseUrl, cluster);

process.stdout.write('Integrity policy branch and edge-case coverage suite completed.\n');