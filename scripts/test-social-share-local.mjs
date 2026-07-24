import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

function readLocalEnvironment() {
  const result = spawnSync('supabase', ['status', '-o', 'env'], { cwd: process.cwd(), encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`supabase status failed: ${result.stderr || result.stdout}`);
  const values = {};
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(?:"([^"]*)"|'([^']*)'|(.*))$/);
    if (match) values[match[1]] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  const apiUrl = values.API_URL || values.SUPABASE_URL;
  const serviceRoleKey = values.SERVICE_ROLE_KEY;
  if (!apiUrl || !serviceRoleKey) throw new Error('Local Supabase environment is incomplete.');
  return { apiUrl: apiUrl.replace(/\/$/, ''), serviceRoleKey };
}

function assertPng(response, png, label) {
  assert.equal(response.status, 200, new TextDecoder().decode(png));
  assert.match(response.headers.get('content-type') || '', /^image\/png/);
  assert.deepEqual([...png.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(png.length > 15_000, `${label} PNG is unexpectedly small: ${png.length} bytes.`);
  const buffer = Buffer.from(png);
  assert.equal(buffer.readUInt32BE(16), 1200, `${label} width`);
  assert.equal(buffer.readUInt32BE(20), 630, `${label} height`);
  assert.match(response.headers.get('cache-control') || '', /max-age=300/);
}

function assertSocialHtml(html, { canonicalPattern, imagePattern, titlePattern }) {
  assert.match(html, /property="og:image"/);
  assert.match(html, /property="og:image:secure_url"/);
  assert.match(html, /property="og:image:width" content="1200"/);
  assert.match(html, /property="og:image:height" content="630"/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  assert.match(html, /name="twitter:image"/);
  assert.match(html, /name="twitter:image:src"/);
  assert.match(html, canonicalPattern);
  assert.match(html, imagePattern);
  assert.match(html, titlePattern);
}

function persistPreview(name, png) {
  const path = resolve('.tmp/pr-previews/social', name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, png);
}

const { apiUrl, serviceRoleKey } = readLocalEnvironment();
const headers = {
  apikey: serviceRoleKey,
  authorization: `Bearer ${serviceRoleKey}`,
};

async function json(path, options = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    method: options.method ?? 'GET',
    headers: { ...headers, ...(options.body ? { 'content-type': 'application/json' } : {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  assert.ok(response.ok, `${path} failed (${response.status}): ${text}`);
  return text ? JSON.parse(text) : null;
}

async function socialHtml(path) {
  const response = await fetch(`${apiUrl}${path}`, {
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  });
  const html = await response.text();
  assert.equal(response.status, 200, html);
  return html;
}

async function socialPng(path, filename, label) {
  const response = await fetch(`${apiUrl}${path}`, {
    headers,
    signal: AbortSignal.timeout(60_000),
  });
  const png = new Uint8Array(await response.arrayBuffer());
  assertPng(response, png, label);
  persistPreview(filename, png);
}

const stats = await json('/functions/v1/game-api', {
  method: 'POST',
  body: { action: 'stats' },
});
const player = stats.leaderboard?.[0];
assert.ok(player?.nick, 'The integration journey must create at least one ranked player.');

const profile = await json('/rest/v1/rpc/get_game_player_profile', {
  method: 'POST',
  body: { p_nick_key: String(player.nick).toLocaleLowerCase('es') },
});
assert.ok(Number(profile.profileRevision) > 0);
assert.match(String(profile.referralCode), /^[0-9a-f-]{36}$/i);
const nick = encodeURIComponent(player.nick);
const profileRevision = String(profile.profileRevision);

const profileHtml = await socialHtml(`/functions/v1/social-share/player/${nick}/achievements?v=${profileRevision}`);
assertSocialHtml(profileHtml, {
  canonicalPattern: new RegExp(`/player/${nick}/achievements`),
  imagePattern: new RegExp(`/functions/v1/player-share/${nick}/achievements\\.png\\?v=${profileRevision}`),
  titlePattern: new RegExp(player.nick, 'i'),
});
assert.match(profileHtml, new RegExp(`/functions/v1/social-share/player/${nick}/achievements\\?v=${profileRevision}`));

const leagues = await json('/rest/v1/game_leagues?select=code&order=created_at.desc&limit=1');
const leagueCode = leagues?.[0]?.code;
assert.match(String(leagueCode), /^[A-Z0-9]{6}$/);
const league = await json('/rest/v1/rpc/get_game_league', {
  method: 'POST',
  body: { p_code: leagueCode },
});
assert.ok(Number(league.revision) > 0);
const leagueRevision = String(league.revision);
const leagueHtml = await socialHtml(`/functions/v1/social-share/league/${leagueCode}?v=${leagueRevision}`);
assertSocialHtml(leagueHtml, {
  canonicalPattern: new RegExp(`ligas\\.html\\?league=${leagueCode}`),
  imagePattern: new RegExp(`/functions/v1/social-share/league/${leagueCode}/card\\.png\\?v=${leagueRevision}`),
  titlePattern: new RegExp(String(league.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
});
await socialPng(
  `/functions/v1/social-share/league/${leagueCode}/card.png?v=${leagueRevision}`,
  'league-card.png',
  'League social card',
);

const duels = await json('/rest/v1/game_duels?select=code,challenger_elapsed_ms,challenger_best_difference_ms,created_at&order=created_at.desc&limit=1');
const duel = duels?.[0];
assert.match(String(duel?.code), /^[0-9a-f-]{36}$/i);
assert.ok(Number(duel?.challenger_elapsed_ms) >= 500);
const publicDuel = await json('/rest/v1/rpc/get_game_public_duel', {
  method: 'POST',
  body: { p_code: duel.code },
});
assert.equal(Number(publicDuel.targetElapsedMs), Number(duel.challenger_elapsed_ms));
assert.equal(Number(publicDuel.targetDifferenceMs), Number(duel.challenger_best_difference_ms));
const duelRevision = String(publicDuel.revision);
const duelHtml = await socialHtml(`/functions/v1/social-share/duel/${duel.code}?v=${duelRevision}`);
assertSocialHtml(duelHtml, {
  canonicalPattern: new RegExp(`\\?duel=${duel.code}`),
  imagePattern: new RegExp(`/functions/v1/social-share/duel/${duel.code}/card\\.png\\?v=${duelRevision}`),
  titlePattern: /te reta/i,
});
assert.match(duelHtml, new RegExp(`${(Number(publicDuel.targetElapsedMs) / 1000).toFixed(3)} s`));
await socialPng(
  `/functions/v1/social-share/duel/${duel.code}/card.png?v=${duelRevision}`,
  'duel-card.png',
  'Duel social card',
);

const attempts = await json('/rest/v1/game_attempts?select=id,nick,client_elapsed_ms,difference_ms,created_at&league_id=is.null&verified=eq.true&order=created_at.desc&limit=1');
const attempt = attempts?.[0];
assert.match(String(attempt?.id), /^[0-9a-f-]{36}$/i);
const publicAttempt = await json('/rest/v1/rpc/get_game_public_attempt', {
  method: 'POST',
  body: { p_attempt_id: attempt.id },
});
assert.equal(Number(publicAttempt.elapsedMs), Number(attempt.client_elapsed_ms));
assert.equal(Number(publicAttempt.differenceMs), Number(attempt.difference_ms));
const resultRevision = String(publicAttempt.revision);
const resultHtml = await socialHtml(`/functions/v1/social-share/result/${attempt.id}?v=${resultRevision}`);
assertSocialHtml(resultHtml, {
  canonicalPattern: new RegExp(`\\?sharedResult=${attempt.id}`),
  imagePattern: new RegExp(`/functions/v1/social-share/result/${attempt.id}/card\\.png\\?v=${resultRevision}`),
  titlePattern: new RegExp(String(attempt.nick).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
});
assert.match(resultHtml, new RegExp(`${(Number(attempt.client_elapsed_ms) / 1000).toFixed(3)} s`));
await socialPng(
  `/functions/v1/social-share/result/${attempt.id}/card.png?v=${resultRevision}`,
  'result-card.png',
  'Result social card',
);

const referralCode = String(profile.referralCode);
const referralHtml = await socialHtml(`/functions/v1/social-share/referral/${referralCode}?v=${profileRevision}`);
assertSocialHtml(referralHtml, {
  canonicalPattern: new RegExp(`\\?ref=${referralCode}`),
  imagePattern: new RegExp(`/functions/v1/social-share/referral/${referralCode}/card\\.png\\?v=${profileRevision}`),
  titlePattern: /te invita/i,
});
await socialPng(
  `/functions/v1/social-share/referral/${referralCode}/card.png?v=${profileRevision}`,
  'referral-card.png',
  'Referral social card',
);

console.log('Profile, league, duel, result and referral Open Graph/Twitter previews passed.');
