import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/player-ui.js', import.meta.url), 'utf8');

function loadPlayerUi() {
  const context = {
    URL,
    String,
    Object,
    Array,
    Number,
    encodeURIComponent,
    decodeURIComponent,
    document: { baseURI: 'https://example.test/106/ranking.html' },
    location: { href: 'https://example.test/106/ranking.html' },
  };
  vm.runInNewContext(source, context, { filename: 'public/player-ui.js' });
  return { api: context.Minuto106PlayerUI, context };
}

test('normalizes and escapes public player inputs', () => {
  const { api } = loadPlayerUi();
  assert.equal(api.escapeHtml(`&<>'"`), '&amp;&lt;&gt;&#39;&quot;');
  assert.equal(api.escapeHtml(null), '');
  assert.equal(api.normalizeNick('  Ｊuan   Pérez  '), 'Juan Pérez');
  assert.equal(api.normalizeNick(null), '');
  assert.equal(api.normalizeNick('12345678901234567890123456789'), '123456789012345678901234');
  assert.equal(api.normalizeSection('achievements'), 'achievements');
  assert.equal(api.normalizeSection('invalid'), 'overview');
});

test('resolves teams from direct, profile and history sources', () => {
  const { api } = loadPlayerUi();
  assert.equal(api.resolveTeam('spain').name, 'España');
  assert.equal(api.resolveTeam('', { team: 'argentina' }).name, 'Argentina');
  assert.equal(api.resolveTeam('', { history: [{ team: 'invalid' }, { team: 'spain' }] }).key, 'spain');
  assert.equal(api.resolveTeam('toString', { team: 'invalid', history: [] }), null);
  assert.equal(api.teamHtml('argentina'), '<span class="player-team"><span class="flag flag--argentina" aria-hidden="true"></span><span>Argentina</span></span>');
  assert.match(api.teamHtml('spain', null, 'player-team--hero'), /player-team--hero/);
  assert.match(api.teamHtml('', { history: [] }, 'x" y'), /player-team--unknown/);
});

test('builds application, player and shell routes from every base source', () => {
  const { api, context } = loadPlayerUi();
  assert.equal(api.appBaseUrl().toString(), 'https://example.test/106/');
  assert.equal(api.appBaseUrl('https://example.test/106/player/Juan/trophies').toString(), 'https://example.test/106/');
  context.document = undefined;
  assert.equal(api.appBaseUrl().toString(), 'https://example.test/106/');
  context.location = undefined;
  assert.equal(api.appBaseUrl().toString(), 'http://localhost/');
  assert.equal(api.playerUrl('Juan Pérez', 'overview', 'https://example.test/106/ranking.html'), 'https://example.test/106/player/Juan%20P%C3%A9rez');
  assert.equal(api.playerUrl('Juan', 'trophies', 'https://example.test/106/'), 'https://example.test/106/player/Juan/trophies');
  assert.equal(api.playerShellUrl('Juan', 'overview', 'https://example.test/106/'), 'https://example.test/106/player.html?nick=Juan');
  assert.equal(api.playerShellUrl('Juan', 'achievements', 'https://example.test/106/'), 'https://example.test/106/player.html?nick=Juan&section=achievements');
});

test('parses query, clean, malformed and unrelated locations', () => {
  const { api, context } = loadPlayerUi();
  context.location = { href: 'https://example.test/106/player.html?nick=Ana%20Mar&section=trophies' };
  assert.deepEqual({ ...api.parsePlayerLocation() }, { nick: 'Ana Mar', section: 'trophies' });
  assert.deepEqual({ ...api.parsePlayerLocation({ href: 'https://example.test/106/player/Juan%20P%C3%A9rez/achievements' }) }, { nick: 'Juan Pérez', section: 'achievements' });
  assert.deepEqual({ ...api.parsePlayerLocation('https://example.test/106/player/%E0%A4%A/trophies') }, { nick: '%E0%A4%A', section: 'trophies' });
  assert.deepEqual({ ...api.parsePlayerLocation(null) }, { nick: '', section: 'overview' });
  assert.deepEqual({ ...api.parsePlayerLocation('https://example.test/106/ranking.html') }, { nick: '', section: 'overview' });
});

test('builds share and png endpoints without leaking previous paths', () => {
  const { api } = loadPlayerUi();
  assert.equal(api.edgeFunctionBaseUrl('', 'player-share'), null);
  assert.equal(api.edgeFunctionBaseUrl('https://project.supabase.co/functions/v1/game-api?x=1#hash', 'player-share').toString(), 'https://project.supabase.co/functions/v1/player-share');
  assert.equal(api.shareUrl('', 'Juan', 'trophies'), 'https://example.test/106/player/Juan/trophies');
  assert.equal(api.shareUrl('https://project.supabase.co/functions/v1/game-api', 'Juan Pérez'), 'https://project.supabase.co/functions/v1/player-share/Juan%20P%C3%A9rez');
  assert.equal(api.shareUrl('https://project.supabase.co/functions/v1/game-api', 'Juan', 'achievements'), 'https://project.supabase.co/functions/v1/player-share/Juan/achievements');
  assert.equal(api.cardUrl('', 'Juan'), '');
  assert.equal(api.cardUrl('https://project.supabase.co/functions/v1/game-api', 'Juan'), 'https://project.supabase.co/functions/v1/player-share/Juan/card.png');
  assert.equal(api.cardUrl('https://project.supabase.co/functions/v1/game-api', 'Juan', 'trophies'), 'https://project.supabase.co/functions/v1/player-share/Juan/trophies.png');
});

test('renders accessible player links and dates', () => {
  const { api } = loadPlayerUi();
  const generated = api.playerLinkHtml({ nick: 'Juan & Ana', team: 'spain', baseHref: 'https://example.test/106/' });
  assert.match(generated, /href="https:\/\/example\.test\/106\/player\/Juan%20%26%20Ana"/);
  assert.match(generated, /flag--spain/);
  assert.match(generated, /Juan &amp; Ana/);
  const custom = api.playerLinkHtml({ nick: 'Ana', className: 'x" y', content: '<b>Custom</b>', section: 'trophies', baseHref: 'https://example.test/106/' });
  assert.match(custom, /class="x&quot; y"/);
  assert.match(custom, /<b>Custom<\/b>/);
  assert.equal(api.formatDate(null), '—');
  assert.equal(api.formatDate('not-a-date'), '—');
  assert.match(api.formatDate('2026-07-22'), /2026/);
  assert.ok(Object.isFrozen(api));
});