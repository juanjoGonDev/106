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
  const hours = 12 + Math.floor(minute / 60);
  const minutes = minute % 60;
  return `${date}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00+02:00`;
}

function player(prefix, suffix) {
  return {
    nick: `${prefix}${suffix}`.slice(0, 24),
    nick_key: `${prefix}${suffix}`.toLocaleLowerCase('es').slice(0, 24),
    first_device_hash: `device-${prefix}-${suffix}`,
    first_ip_hash: `ip-${prefix}-${suffix}`,
  };
}

async function insertAttempts({ participant, date, differences, verified = true, leagueId = null, minuteStart = 0 }) {
  const challenges = [];
  const attempts = [];
  differences.forEach((difference, index) => {
    const challengeId = randomUUID();
    const createdAt = timestamp(date, minuteStart + index);
    challenges.push({
      id: challengeId,
      nick: participant.nick,
      nick_key: participant.nick_key,
      team: index % 2 === 0 ? 'spain' : 'argentina',
      device_hash: participant.first_device_hash,
      ip_hash: participant.first_ip_hash,
      league_id: leagueId,
      started_at: createdAt,
      expires_at: new Date(new Date(createdAt).getTime() + 30_000).toISOString(),
      consumed_at: createdAt,
    });
    attempts.push({
      id: randomUUID(),
      challenge_id: challengeId,
      nick: participant.nick,
      nick_key: participant.nick_key,
      team: index % 2 === 0 ? 'spain' : 'argentina',
      device_hash: participant.first_device_hash,
      ip_hash: participant.first_ip_hash,
      client_elapsed_ms: 10_600 + difference,
      server_elapsed_ms: 10_600 + difference,
      difference_ms: difference,
      verified,
      verification_reasons: verified ? [] : ['fixture_unverified'],
      league_id: leagueId,
      created_at: createdAt,
    });
  });
  await insert('game_challenges', challenges);
  await insert('game_attempts', attempts);
}

function findTrophy(rows, date, type) {
  return rows.find((row) => row.award_date === date && row.trophy_type === type);
}

function logStep(message) {
  process.stdout.write(`✓ ${message}\n`);
}

async function runSmokeCheck() {
  const stats = await rpc('get_game_stats');
  assert.ok(Array.isArray(stats.honoursRankings?.trophies));
  assert.ok(Array.isArray(stats.honoursRankings?.achievements));
  logStep('Trophy and achievement contracts survive a full database rebuild');
}

async function runFixtureJourney() {
  const prefix = `T${Date.now().toString(36).slice(-5)}`;
  const alpha = player(prefix, 'Alpha');
  const bravo = player(prefix, 'Bravo');
  const charlie = player(prefix, 'Charlie');
  const delta = player(prefix, 'Delta');
  const leaguePlayer = player(prefix, 'League');
  const provisional = player(prefix, 'Today');
  const players = [alpha, bravo, charlie, delta, leaguePlayer, provisional];
  await insert('game_players', players);

  const leagueId = randomUUID();
  await insert('game_leagues', [{
    id: leagueId,
    code: prefix.replace(/[^A-Z0-9]/gi, '').toUpperCase().padEnd(6, 'X').slice(-6),
    name: `Trophy fixture ${prefix}`.slice(0, 40),
    owner_nick_key: leaguePlayer.nick_key,
    owner_device_hash: leaguePlayer.first_device_hash,
    starts_at: timestamp(madridDate(-20)),
    ends_at: timestamp(madridDate(2)),
  }]);

  const dates = Array.from({ length: 8 }, (_, index) => madridDate(index - 12));
  const [day1, day2, day3, day4, day5, day6, day7, tieDay] = dates;

  await insertAttempts({ participant: alpha, date: day1, differences: [10, 20, 30] });
  await insertAttempts({ participant: bravo, date: day1, differences: [5], minuteStart: 20 });

  await insertAttempts({ participant: alpha, date: day2, differences: [5, 15, 25] });

  await insertAttempts({ participant: alpha, date: day3, differences: [10, 20, 30] });
  await insertAttempts({ participant: bravo, date: day3, differences: [9, 100, 100, 100], minuteStart: 20 });

  await insertAttempts({ participant: alpha, date: day4, differences: [4] });
  await insertAttempts({ participant: bravo, date: day4, differences: [0, 0, 0, 0, 0], verified: false, minuteStart: 20 });
  await insertAttempts({ participant: leaguePlayer, date: day4, differences: [0, 0, 0, 0, 0], leagueId, minuteStart: 30 });

  for (const date of [day5, day6, day7]) {
    await insertAttempts({ participant: alpha, date, differences: [6, 7, 8] });
  }

  await insertAttempts({ participant: charlie, date: tieDay, differences: [12, 22, 32] });
  await insertAttempts({ participant: delta, date: tieDay, differences: [12, 22, 32], minuteStart: 20 });

  const processed = await rpc('sync_game_trophy_history');
  assert.equal(processed, dates.length);
  const secondPass = await rpc('sync_game_trophy_history');
  assert.equal(secondPass, 0);
  logStep('Historical award synchronization is deterministic and idempotent');

  const trophyRows = await table(
    'game_daily_trophies',
    `award_date=gte.${day1}&award_date=lte.${tieDay}&select=award_date,trophy_type,nick_key,metric_value,attempt_count,best_difference_ms,average_difference_ms&order=award_date.asc,trophy_type.asc`,
  );
  assert.equal(findTrophy(trophyRows, day1, 'golden_boot')?.nick_key, bravo.nick_key);
  assert.equal(findTrophy(trophyRows, day1, 'golden_glove')?.nick_key, alpha.nick_key);
  assert.equal(findTrophy(trophyRows, day1, 'golden_ball')?.nick_key, alpha.nick_key);
  assert.equal(findTrophy(trophyRows, day3, 'golden_boot')?.nick_key, bravo.nick_key);
  assert.equal(findTrophy(trophyRows, day3, 'golden_glove')?.nick_key, alpha.nick_key);
  assert.equal(findTrophy(trophyRows, day3, 'golden_ball')?.nick_key, bravo.nick_key);
  assert.equal(findTrophy(trophyRows, day4, 'golden_glove'), undefined);
  assert.equal(findTrophy(trophyRows, day4, 'golden_boot')?.nick_key, alpha.nick_key);
  assert.equal(findTrophy(trophyRows, tieDay, 'golden_boot')?.nick_key, charlie.nick_key);
  assert.equal(findTrophy(trophyRows, tieDay, 'golden_glove')?.nick_key, charlie.nick_key);
  assert.equal(findTrophy(trophyRows, tieDay, 'golden_ball')?.nick_key, charlie.nick_key);
  assert.ok(!trophyRows.some((row) => row.nick_key === leaguePlayer.nick_key));
  logStep('Boot, Glove and Ball rules ignore league/unverified attempts and resolve ties by earliest verified result');

  const runRows = await table(
    'game_trophy_award_runs',
    `award_date=gte.${day1}&award_date=lte.${tieDay}&select=award_date,trophy_count&order=award_date.asc`,
  );
  assert.equal(runRows.length, dates.length);
  assert.equal(runRows.find((run) => run.award_date === day4)?.trophy_count, 2);
  logStep('Every closed fixture day records an auditable processing run and actual award count');

  const alphaProfile = await rpc('get_game_player_profile', { p_nick_key: alpha.nick_key });
  assert.equal(alphaProfile.nick, alpha.nick);
  assert.ok(alphaProfile.trophies.total >= 17);
  assert.equal(alphaProfile.trophies.history[0].date, day7);
  assert.ok(alphaProfile.trophies.goldenBoot >= 5);
  assert.ok(alphaProfile.trophies.goldenGlove >= 6);
  assert.ok(alphaProfile.trophies.goldenBall >= 6);
  const achievementCodes = new Set(alphaProfile.achievements.items.map((achievement) => achievement.code));
  for (const expected of [
    'first_trophy',
    'trophy_total_3',
    'trophy_total_10',
    'category_total_golden_boot_3',
    'category_total_golden_glove_3',
    'category_total_golden_ball_3',
    'trophy_streak_2',
    'trophy_streak_3',
    'trophy_streak_7',
    'complete_set',
    `daily_hat_trick_${day2.replaceAll('-', '_')}`,
  ]) assert.ok(achievementCodes.has(expected), `Missing ${expected}`);
  assert.ok([...achievementCodes].some((code) => code.startsWith('first_of_month_golden_glove_')));
  assert.ok([...achievementCodes].some((code) => code.startsWith('first_of_month_golden_ball_')));
  logStep('Profiles expose dated trophy counts, a seven-day streak, collection, thresholds, monthly firsts and a daily hat trick');

  const bravoProfile = await rpc('get_game_player_profile', { p_nick_key: bravo.nick_key });
  const bravoCodes = new Set(bravoProfile.achievements.items.map((achievement) => achievement.code));
  assert.ok([...bravoCodes].some((code) => code.startsWith('first_of_month_golden_boot_')));

  const rankings = await rpc('get_game_honours_rankings');
  assert.equal(rankings.trophies[0].nick, alpha.nick);
  assert.equal(rankings.trophies[0].rank, 1);
  assert.equal(rankings.achievements[0].nick, alpha.nick);
  assert.ok(rankings.achievements[0].achievementPoints > 0);
  logStep('Trophy and achievement rankings aggregate persisted history with deterministic positions');

  const today = madridDate(0);
  await insertAttempts({ participant: provisional, date: today, differences: [1, 2, 3] });
  const attemptedCurrentAward = await rpc('award_game_trophies_for_date', { p_award_date: today });
  assert.equal(attemptedCurrentAward, 0);
  const currentPersisted = await table('game_daily_trophies', `award_date=eq.${today}&select=id`);
  assert.equal(currentPersisted.length, 0);
  const provisionalAwards = await rpc('get_game_daily_awards');
  assert.equal(provisionalAwards.provisional, true);
  assert.equal(provisionalAwards.date, today);
  assert.ok(provisionalAwards.goldenBoot?.nick);
  assert.ok(provisionalAwards.goldenGlove?.nick);
  assert.ok(provisionalAwards.goldenBall?.nick);
  logStep('The current Madrid day remains provisional and cannot be persisted early');
}

if (process.env.SUPABASE_SMOKE_ONLY === 'true') await runSmokeCheck();
else await runFixtureJourney();
