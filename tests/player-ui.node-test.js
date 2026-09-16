import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const policySource = readFileSync(new URL('../public/nickname-policy.js', import.meta.url), 'utf8');
const radarSource = readFileSync(new URL('../public/player-radar-model.js', import.meta.url), 'utf8');
const source = readFileSync(new URL('../public/player-ui.js', import.meta.url), 'utf8');

function loadPlayerUi({ withPolicy = true, withRadar = true } = {}) {
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
  if (withPolicy) vm.runInNewContext(policySource, context, { filename: 'public/nickname-policy.js' });
  if (withRadar) vm.runInNewContext(radarSource, context, { filename: 'public/player-radar-model.js' });
  vm.runInNewContext(source, context, { filename: 'public/player-ui.js' });
  return { api: context.Minuto106PlayerUI, context };
}

test('normalizes, validates and escapes public player inputs', () => {
  const { api } = loadPlayerUi();
  assert.equal(api.escapeHtml(`&<>'"`), '&amp;&lt;&gt;&#39;&quot;');
  assert.equal(api.escapeHtml(null), '');
  assert.equal(api.normalizeNick('  Ｊuan   Pérez  '), 'Juan Pérez');
  assert.equal(api.normalizeNick(null), '');
  assert.equal(api.normalizeNick('12345678901234567890123456789'), '123456789012345678901234');
  assert.equal(api.isValidNickname('Ana'), true);
  assert.equal(api.isValidNickname('..'), false);
  assert.equal(api.normalizeSection('achievements'), 'achievements');
  assert.equal(api.normalizeSection('invalid'), 'overview');
  assert.equal(api.normalizeRevision(42.9), 42);
  assert.equal(api.normalizeRevision(-1), 0);
  assert.equal(api.normalizeRevision('invalid'), 0);

  const fallback = loadPlayerUi({ withPolicy: false }).api;
  assert.equal(fallback.normalizeNick('  Ana  María  '), 'Ana María');
  assert.equal(fallback.isValidNickname('Ana'), true);
  assert.equal(fallback.isValidNickname('..'), false);
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

test('builds application, player and safe shell routes from every base source', () => {
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
  assert.equal(api.playerUrl('../..', 'overview', 'https://example.test/106/'), 'https://example.test/106/player.html?nick=..%2F..');
  assert.equal(new URL(api.playerUrl('../..', 'overview', 'https://example.test/106/')).pathname, '/106/player.html');
});

test('parses valid query and clean routes while rejecting malformed and unrelated locations', () => {
  const { api, context } = loadPlayerUi();
  context.location = { href: 'https://example.test/106/player.html?nick=Ana%20Mar&section=trophies' };
  assert.deepEqual({ ...api.parsePlayerLocation() }, { nick: 'Ana Mar', section: 'trophies' });
  assert.deepEqual({ ...api.parsePlayerLocation({ href: 'https://example.test/106/player/Juan%20P%C3%A9rez/achievements' }) }, { nick: 'Juan Pérez', section: 'achievements' });
  assert.deepEqual({ ...api.parsePlayerLocation('https://example.test/106/player/%E0%A4%A/trophies') }, { nick: '', section: 'trophies' });
  assert.deepEqual({ ...api.parsePlayerLocation('https://example.test/106/player.html?nick=..%2F..&section=achievements') }, { nick: '', section: 'achievements' });
  assert.deepEqual({ ...api.parsePlayerLocation('https://example.test/106/player/../..') }, { nick: '', section: 'overview' });
  assert.deepEqual({ ...api.parsePlayerLocation(null) }, { nick: '', section: 'overview' });
  assert.deepEqual({ ...api.parsePlayerLocation('https://example.test/106/ranking.html') }, { nick: '', section: 'overview' });
});

test('builds public share routes and data-plus-renderer-versioned png endpoints', () => {
  const { api, context } = loadPlayerUi();
  const rendererRevision = context.Minuto106PlayerRadarModel.cardRendererRevision;
  assert.equal(api.edgeFunctionBaseUrl('', 'player-share'), null);
  assert.equal(api.edgeFunctionBaseUrl('https://project.supabase.co/functions/v1/game-api?x=1#hash', 'player-share').toString(), 'https://project.supabase.co/functions/v1/player-share');
  assert.equal(api.shareUrl('', 'Juan', 'trophies'), 'https://example.test/106/player/Juan/trophies');
  assert.equal(api.shareUrl('https://project.supabase.co/functions/v1/game-api', 'Juan Pérez'), 'https://example.test/106/player/Juan%20P%C3%A9rez');
  assert.equal(api.shareUrl('https://project.supabase.co/functions/v1/game-api', 'Juan', 'achievements', 123.8), 'https://example.test/106/player/Juan/achievements');
  assert.equal(api.shareUrl('https://public.example/106/', 'Juan', 'trophies'), 'https://public.example/106/player/Juan/trophies');
  assert.equal(api.cardUrl('', 'Juan'), '');
  assert.equal(api.cardUrl('https://project.supabase.co/functions/v1/game-api', '..'), '');
  assert.equal(api.cardUrl('https://project.supabase.co/functions/v1/game-api', 'Juan'), `https://project.supabase.co/functions/v1/player-share/Juan/card.png?v=0&r=${rendererRevision}`);
  assert.equal(api.cardUrl('https://project.supabase.co/functions/v1/game-api', 'Juan', 'trophies', 456), `https://project.supabase.co/functions/v1/player-share/Juan/trophies.png?v=456&r=${rendererRevision}`);
  assert.equal(api.cardUrl('https://project.supabase.co/functions/v1/game-api', 'Juan', 'trophies', 456, 9), 'https://project.supabase.co/functions/v1/player-share/Juan/trophies.png?v=456&r=9');

  const legacyRuntime = loadPlayerUi({ withRadar: false }).api;
  assert.equal(legacyRuntime.cardUrl('https://project.supabase.co/functions/v1/game-api', 'Juan'), 'https://project.supabase.co/functions/v1/player-share/Juan/card.png?v=0&r=0');
});

test('renders accessible player links and dates', () => {
  const { api } = loadPlayerUi();
  const generated = api.playerLinkHtml({ nick: 'Juan & Ana', team: 'spain', baseHref: 'https://example.test/106/' });
  const href = generated.match(/href="([^"]+)"/)?.[1];
  assert.ok(href);
  const playerUrl = new URL(href);
  assert.equal(playerUrl.pathname, '/106/player.html');
  assert.equal(playerUrl.searchParams.get('nick'), 'Juan & Ana');
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
