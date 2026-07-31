import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { PLAYER_CARD_RENDERER_REVISION } from '../shared/player-radar-model.js';

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

function assertPng(response, png, label, expectedMaxAge, { rendererRevision = null } = {}) {
  assert.equal(response.status, 200, new TextDecoder().decode(png));
  assert.match(response.headers.get('content-type') || '', /^image\/png/);
  assert.deepEqual([...png.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(png.length > 15_000, `${label} PNG is unexpectedly small: ${png.length} bytes.`);
  const buffer = Buffer.from(png);
  assert.equal(buffer.readUInt32BE(16), 1200, `${label} width`);
  assert.equal(buffer.readUInt32BE(20), 630, `${label} height`);
  assert.match(response.headers.get('cache-control') || '', new RegExp(`max-age=${expectedMaxAge}`));
  if (rendererRevision !== null) {
    assert.equal(response.headers.get('x-minuto106-card-renderer'), String(rendererRevision));
  }
}

function persistPreview(name, png) {
  const path = resolve('.tmp/pr-previews/social', name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, png);
}

function htmlAttributeUrl(html, property) {
  const escapedProperty = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp(`<meta property="${escapedProperty}" content="([^"]+)"`));
  assert.ok(match?.[1], `Missing ${property} metadata.`);
  return new URL(match[1].replaceAll('&amp;', '&'));
}

const { apiUrl, serviceRoleKey } = readLocalEnvironment();
const functionHeaders = {
  apikey: serviceRoleKey,
  authorization: `Bearer ${serviceRoleKey}`,
};

async function gameStats() {
  const response = await fetch(`${apiUrl}/functions/v1/game-api`, {
    method: 'POST',
    headers: { ...functionHeaders, 'content-type': 'application/json', 'x-device-id': 'player-share-ci-device-106' },
    body: JSON.stringify({ action: 'stats' }),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  assert.equal(response.status, 200, text);
  return JSON.parse(text);
}

async function playerProfile(nick) {
  const response = await fetch(`${apiUrl}/rest/v1/rpc/get_game_player_profile`, {
    method: 'POST',
    headers: { ...functionHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ p_nick_key: nick.toLocaleLowerCase('es') }),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  assert.equal(response.status, 200, text);
  return JSON.parse(text);
}

const stats = await gameStats();
const player = stats.leaderboard?.[0];
assert.ok(player?.nick, 'The integration journey must create at least one ranked player.');
for (const award of Object.values(stats.awards || {})) {
  if (award?.nick) assert.ok(['spain', 'argentina'].includes(award.team), `Award ${award.nick} must expose a team.`);
}
for (const ranking of [...(stats.honoursRankings?.trophies || []), ...(stats.honoursRankings?.achievements || [])]) {
  assert.ok(ranking.nick, 'Every honours row must expose a nickname.');
  if (ranking.team !== null && ranking.team !== undefined && ranking.team !== '') {
    assert.ok(['spain', 'argentina'].includes(ranking.team), `Honours row ${ranking.nick} exposes an invalid team.`);
  }
}

const profile = await playerProfile(player.nick);
assert.equal(profile.nick, player.nick);
assert.ok(Object.hasOwn(profile, 'lifetimeAttemptsUsed'), 'The card profile contract must expose lifetimeAttemptsUsed.');
assert.ok(Number(profile.lifetimeAttemptsUsed) >= Number(profile.verifiedAttempts || 0));

const nick = encodeURIComponent(player.nick);
const htmlResponse = await fetch(`${apiUrl}/functions/v1/player-share/${nick}/achievements`, {
  headers: functionHeaders,
  redirect: 'manual',
  signal: AbortSignal.timeout(30_000),
});
const html = await htmlResponse.text();
assert.equal(htmlResponse.status, 200, html);
assert.match(htmlResponse.headers.get('content-type') || '', /^text\/html/);
assert.equal(htmlResponse.headers.get('x-minuto106-card-renderer'), String(PLAYER_CARD_RENDERER_REVISION));
assert.match(html, /property="og:image"/);
assert.match(html, /property="og:image:secure_url"/);
assert.match(html, /name="twitter:card" content="summary_large_image"/);
assert.match(html, /name="twitter:image:src"/);
assert.match(html, new RegExp(`/functions/v1/player-share/${nick}/achievements\\.png`));
assert.doesNotMatch(html, /achievements\/achievements\.png/);
assert.match(html, new RegExp(player.nick.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

const achievementsImageUrl = htmlAttributeUrl(html, 'og:image');
assert.equal(achievementsImageUrl.searchParams.get('v'), String(Math.max(0, Math.trunc(Number(profile.profileRevision) || 0))));
assert.equal(achievementsImageUrl.searchParams.get('r'), String(PLAYER_CARD_RENDERER_REVISION));

const overviewImageUrl = new URL(achievementsImageUrl);
overviewImageUrl.pathname = overviewImageUrl.pathname.replace(/\/achievements\.png$/, '/card.png');
const overviewResponse = await fetch(overviewImageUrl, {
  headers: functionHeaders,
  signal: AbortSignal.timeout(60_000),
});
const overviewPng = new Uint8Array(await overviewResponse.arrayBuffer());
assertPng(overviewResponse, overviewPng, 'Player overview', 300, { rendererRevision: PLAYER_CARD_RENDERER_REVISION });
persistPreview('player-overview.png', overviewPng);

const playerResponse = await fetch(achievementsImageUrl, {
  headers: functionHeaders,
  signal: AbortSignal.timeout(60_000),
});
const playerPng = new Uint8Array(await playerResponse.arrayBuffer());
assertPng(playerResponse, playerPng, 'Player achievements', 300, { rendererRevision: PLAYER_CARD_RENDERER_REVISION });
persistPreview('player-achievements.png', playerPng);

const siteHtmlResponse = await fetch(`${apiUrl}/functions/v1/player-share/_site`, {
  headers: functionHeaders,
  redirect: 'manual',
  signal: AbortSignal.timeout(30_000),
});
const siteHtml = await siteHtmlResponse.text();
assert.equal(siteHtmlResponse.status, 200, siteHtml);
assert.match(siteHtml, /player-share\/_site\/card\.png/);
assert.match(siteHtml, /twitter:card/);

const siteResponse = await fetch(`${apiUrl}/functions/v1/player-share/_site/card.png`, {
  headers: functionHeaders,
  signal: AbortSignal.timeout(60_000),
});
const sitePng = new Uint8Array(await siteResponse.arrayBuffer());
assertPng(siteResponse, sitePng, 'Site social card', 31536000);
persistPreview('site-social-card.png', sitePng);

console.log('Player and site social cards passed.');
