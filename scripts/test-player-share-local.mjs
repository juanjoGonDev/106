import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

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

const stats = await gameStats();
const player = stats.leaderboard?.[0];
assert.ok(player?.nick, 'The integration journey must create at least one ranked player.');
for (const award of Object.values(stats.awards || {})) {
  if (award?.nick) assert.ok(['spain', 'argentina'].includes(award.team), `Award ${award.nick} must expose a team.`);
}
for (const ranking of [...(stats.honoursRankings?.trophies || []), ...(stats.honoursRankings?.achievements || [])]) {
  assert.ok(['spain', 'argentina'].includes(ranking.team), `Honours row ${ranking.nick} must expose a team.`);
}

const nick = encodeURIComponent(player.nick);
const htmlResponse = await fetch(`${apiUrl}/functions/v1/player-share/${nick}/achievements`, {
  headers: functionHeaders,
  redirect: 'manual',
  signal: AbortSignal.timeout(30_000),
});
const html = await htmlResponse.text();
assert.equal(htmlResponse.status, 200, html);
assert.match(htmlResponse.headers.get('content-type') || '', /^text\/html/);
assert.match(html, /property="og:image"/);
assert.match(html, /twitter:card/);
assert.match(html, new RegExp(`/functions/v1/player-share/${nick}/achievements\\.png`));
assert.doesNotMatch(html, /achievements\/achievements\.png/);
assert.match(html, new RegExp(player.nick.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

const pngResponse = await fetch(`${apiUrl}/functions/v1/player-share/${nick}/achievements.png`, {
  headers: functionHeaders,
  signal: AbortSignal.timeout(60_000),
});
const png = new Uint8Array(await pngResponse.arrayBuffer());
assert.equal(pngResponse.status, 200, new TextDecoder().decode(png));
assert.match(pngResponse.headers.get('content-type') || '', /^image\/png/);
assert.deepEqual([...png.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
assert.ok(png.length > 15_000, `Generated PNG is unexpectedly small: ${png.length} bytes.`);
assert.match(pngResponse.headers.get('cache-control') || '', /max-age=300/);

console.log('Player share HTML metadata, team payloads and dynamic PNG generation passed.');