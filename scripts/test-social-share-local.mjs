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
const nick = encodeURIComponent(player.nick);
const revision = String(profile.profileRevision);

const profileHtmlResponse = await fetch(`${apiUrl}/functions/v1/social-share/player/${nick}/achievements?v=${revision}`, {
  headers,
  redirect: 'manual',
  signal: AbortSignal.timeout(30_000),
});
const profileHtml = await profileHtmlResponse.text();
assert.equal(profileHtmlResponse.status, 200, profileHtml);
assert.match(profileHtml, /property="og:image"/);
assert.match(profileHtml, /property="og:image:secure_url"/);
assert.match(profileHtml, /name="twitter:image"/);
assert.match(profileHtml, /name="twitter:image:src"/);
assert.match(profileHtml, new RegExp(`/functions/v1/player-share/${nick}/achievements\\.png\\?v=${revision}`));
assert.match(profileHtml, new RegExp(`/functions/v1/social-share/player/${nick}/achievements\\?v=${revision}`));

const leagues = await json('/rest/v1/game_leagues?select=code&order=created_at.desc&limit=1');
const code = leagues?.[0]?.code;
assert.match(String(code), /^[A-Z0-9]{6}$/);
const league = await json('/rest/v1/rpc/get_game_league', {
  method: 'POST',
  body: { p_code: code },
});
assert.ok(Number(league.revision) > 0);
const leagueRevision = String(league.revision);

const leagueHtmlResponse = await fetch(`${apiUrl}/functions/v1/social-share/league/${code}?v=${leagueRevision}`, {
  headers,
  redirect: 'manual',
  signal: AbortSignal.timeout(30_000),
});
const leagueHtml = await leagueHtmlResponse.text();
assert.equal(leagueHtmlResponse.status, 200, leagueHtml);
assert.match(leagueHtml, /property="og:image"/);
assert.match(leagueHtml, /name="twitter:image:src"/);
assert.match(leagueHtml, new RegExp(`/functions/v1/social-share/league/${code}/card\\.png\\?v=${leagueRevision}`));
assert.match(leagueHtml, new RegExp(`ligas\\.html\\?league=${code}`));

const leagueImageResponse = await fetch(`${apiUrl}/functions/v1/social-share/league/${code}/card.png?v=${leagueRevision}`, {
  headers,
  signal: AbortSignal.timeout(60_000),
});
const leaguePng = new Uint8Array(await leagueImageResponse.arrayBuffer());
assertPng(leagueImageResponse, leaguePng, 'League social card');
persistPreview('league-card.png', leaguePng);

console.log('Versioned profile metadata and league Open Graph/Twitter PNG generation passed.');
