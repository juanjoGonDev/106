import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import {
  auditPublicAssets,
  extractAssetReferences,
  formatAssetAudit,
  normalizeRepositoryPath,
  resolveAssetReference,
  walkRepository,
} from '../scripts/public-assets.mjs';

function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'minuto106-assets-'));
  return {
    root,
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
    file(path, content = '') {
      const absolute = join(root, path);
      mkdirSync(join(absolute, '..'), { recursive: true });
      writeFileSync(absolute, content);
      return absolute;
    },
  };
}

test('extracts media references from HTML, CSS, JSON and source strings', () => {
  const references = extractAssetReferences(`
    <img src="./assets/a.svg?v=1">
    <meta content='/assets/social.png#card'>
    <a href="mailto:test@example.com">mail</a>
    <style>.hero{background:url('../media/hero.webp')}</style>
    {"src":"./assets/icon.png"}
    const card = '/public/assets/card.jpg';
    const ignored = 'plain.txt';
  `);
  assert.deepEqual(references.sort(), [
    '../media/hero.webp',
    './assets/a.svg?v=1',
    './assets/icon.png',
    '/assets/social.png#card',
    '/public/assets/card.jpg',
  ]);
});

test('resolves repository, public, app-root and relative asset paths safely', () => {
  const fixture = workspace();
  try {
    const source = fixture.file('public/pages/view.html', '<main></main>');
    assert.equal(normalizeRepositoryPath(fixture.root, source), 'public/pages/view.html');
    assert.equal(resolveAssetReference(fixture.root, source, '/106/public/assets/a.svg'), resolve(fixture.root, 'public/assets/a.svg'));
    assert.equal(resolveAssetReference(fixture.root, source, '/public/assets/a.svg'), resolve(fixture.root, 'public/assets/a.svg'));
    assert.equal(resolveAssetReference(fixture.root, source, '/assets/a.svg'), resolve(fixture.root, 'public/assets/a.svg'));
    assert.equal(resolveAssetReference(fixture.root, source, '/robots.svg'), resolve(fixture.root, 'robots.svg'));
    assert.equal(resolveAssetReference(fixture.root, source, '../assets/a%20b.svg?v=2#x'), resolve(fixture.root, 'public/assets/a b.svg'));
    assert.equal(resolveAssetReference(fixture.root, source, '../assets/%ZZ.svg'), resolve(fixture.root, 'public/assets/%ZZ.svg'));
    for (const value of ['', 'https://example.com/a.png', 'data:image/png;base64,AA', 'blob:abc', 'mailto:a@b.com', 'javascript:void(0)', '#icon.svg', './${name}.png']) {
      assert.equal(resolveAssetReference(fixture.root, source, value), null);
    }
  } finally {
    fixture.cleanup();
  }
});

test('walks repository files while skipping generated and dependency directories', () => {
  const fixture = workspace();
  try {
    fixture.file('public/index.html', 'ok');
    fixture.file('.tmp/ignored.png', 'ignored');
    fixture.file('node_modules/pkg/ignored.js', 'ignored');
    fixture.file('playwright-report/ignored.html', 'ignored');
    fixture.file('test-results/ignored.txt', 'ignored');
    const target = fixture.file('linked-target.txt', 'linked');
    symlinkSync(target, join(fixture.root, 'linked-file'));
    const walked = walkRepository(fixture.root).map((path) => normalizeRepositoryPath(fixture.root, path)).sort();
    assert.deepEqual(walked, ['linked-target.txt', 'public/index.html']);
  } finally {
    fixture.cleanup();
  }
});

test('passes a clean public asset graph with references from different source types', () => {
  const fixture = workspace();
  try {
    fixture.file('public/assets/a.svg', '<svg></svg>');
    fixture.file('public/assets/b.png', 'png-b');
    fixture.file('public/assets/c.webp', 'webp-c');
    fixture.file('public/index.html', '<img src="./assets/a.svg"><meta content="/assets/b.png">');
    fixture.file('public/styles.css', '.hero{background:url("./assets/c.webp")}');
    fixture.file('scripts/source.mjs', "const icon = '/public/assets/a.svg';");
    const report = auditPublicAssets(fixture.root);
    assert.deepEqual(report.invalidRoots, []);
    assert.deepEqual(report.missing, []);
    assert.deepEqual(report.orphaned, []);
    assert.deepEqual(report.duplicates, []);
    assert.deepEqual(report.publicMedia, ['public/assets/a.svg', 'public/assets/b.png', 'public/assets/c.webp']);
    assert.equal(formatAssetAudit(report), '');
  } finally {
    fixture.cleanup();
  }
});

test('reports invalid roots, missing references, orphans and duplicate media', () => {
  const fixture = workspace();
  try {
    fixture.file('assets/root.svg', '<svg></svg>');
    fixture.file('public/public/assets/nested.svg', '<svg></svg>');
    fixture.file('public/assets/a.svg', '<svg id="same"></svg>');
    fixture.file('public/assets/b.svg', '<svg id="same"></svg>');
    fixture.file('public/assets/orphan.png', 'orphan');
    fixture.file('public/index.html', '<img src="./assets/a.svg"><img src="./assets/missing.png">');
    const report = auditPublicAssets(fixture.root);
    assert.deepEqual(report.invalidRoots, ['assets/root.svg', 'public/public/assets/nested.svg']);
    assert.deepEqual(report.missing, [{ source: 'public/index.html', reference: './assets/missing.png' }]);
    assert.deepEqual(report.orphaned, ['public/assets/b.svg', 'public/assets/orphan.png', 'public/public/assets/nested.svg']);
    assert.deepEqual(report.duplicates, [['public/assets/a.svg', 'public/assets/b.svg']]);
    const output = formatAssetAudit(report);
    assert.match(output, /Media must not be tracked outside/);
    assert.match(output, /Referenced media files are missing/);
    assert.match(output, /Public media files are not referenced/);
    assert.match(output, /Duplicate public media content was found/);
    assert.match(output, /public\/assets\/a\.svg, public\/assets\/b\.svg/);
    assert.equal(readFileSync(join(fixture.root, 'public/assets/orphan.png'), 'utf8'), 'orphan');
  } finally {
    fixture.cleanup();
  }
});
