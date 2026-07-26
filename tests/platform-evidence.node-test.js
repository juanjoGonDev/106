import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  createPlatformEvidenceManifest,
  inventoryPlatformEvidence,
  parseEvidenceFile,
  validatePlatformEvidence,
} from '../scripts/platform-evidence.mjs';

const pair = (area, format) => [
  `${area}-desktop.${format}`,
  `${area}-mobile.${format}`,
];

const completeArea = (area) => [
  ...pair(area, 'png'),
  ...pair(area, 'webm'),
  ...pair(area, 'gif'),
];

test('parses normalized platform evidence files and ignores raw recordings', () => {
  assert.deepEqual(parseEvidenceFile('./nested\\Home-Desktop.PNG'), {
    area: 'home',
    device: 'desktop',
    format: 'png',
    path: 'nested/Home-Desktop.PNG',
  });
  assert.equal(parseEvidenceFile('recordings/page@123.webm'), null);
  assert.equal(parseEvidenceFile('home-tablet.png'), null);
  assert.equal(parseEvidenceFile('home-desktop.txt'), null);
  assert.equal(parseEvidenceFile(''), null);
  assert.equal(parseEvidenceFile(null), null);
});

test('inventories unique sorted screenshots and interactions', () => {
  const inventory = inventoryPlatformEvidence([
    'z-mobile.png',
    'z-desktop.png',
    'z-desktop.png',
    'a-desktop.webm',
    'a-desktop.gif',
    'a-mobile.webm',
    'a-mobile.gif',
    'manifest.json',
  ]);
  assert.deepEqual(inventory.files, [
    'a-desktop.gif',
    'a-desktop.webm',
    'a-mobile.gif',
    'a-mobile.webm',
    'manifest.json',
    'z-desktop.png',
    'z-mobile.png',
  ]);
  assert.deepEqual(inventory.snapshots, {
    z: { desktop: ['z-desktop.png'], mobile: ['z-mobile.png'] },
  });
  assert.deepEqual(inventory.interactions, {
    a: {
      desktop: { webm: ['a-desktop.webm'], gif: ['a-desktop.gif'] },
      mobile: { webm: ['a-mobile.webm'], gif: ['a-mobile.gif'] },
    },
  });
  assert.deepEqual(inventoryPlatformEvidence(), { files: [], snapshots: {}, interactions: {} });
});

test('accepts complete configured snapshots and interactions', () => {
  const result = validatePlatformEvidence(
    [...completeArea('home'), ...pair('ranking', 'png')],
    { requiredSnapshots: ['home', 'ranking'], requiredInteractions: ['home'] },
  );
  assert.deepEqual(result.errors, []);
});

test('reports missing and duplicate media once with exact device and format', () => {
  const result = validatePlatformEvidence([
    'home-desktop.png',
    'home-desktop.png',
    'home-desktop.webm',
    'home-desktop.webm',
    'home-mobile.gif',
    'home-mobile.gif',
  ], {
    requiredSnapshots: ['home', 'ranking'],
    requiredInteractions: ['home'],
  });
  assert.deepEqual(result.errors, [
    'home · mobile PNG: missing.',
    'ranking · desktop PNG: missing.',
    'ranking · mobile PNG: missing.',
    'home · desktop GIF: missing.',
    'home · mobile WEBM: missing.',
  ]);

  const duplicates = validatePlatformEvidence([
    'home-desktop.png',
    'nested/home-desktop.png',
    'home-mobile.png',
    'home-desktop.webm',
    'nested/home-desktop.webm',
    'home-desktop.gif',
    'home-mobile.webm',
    'home-mobile.gif',
  ], { requiredSnapshots: ['home'], requiredInteractions: ['home'] });
  assert.deepEqual(duplicates.errors, [
    'home · desktop PNG: duplicate files.',
    'home · desktop WEBM: duplicate files.',
  ]);
});

test('builds a deterministic manifest with sorted file metadata', () => {
  const paths = completeArea('home');
  const manifest = createPlatformEvidenceManifest({
    paths,
    generatedAt: '2026-07-26T20:00:00.000Z',
    commitSha: 'abc123',
    files: [
      { path: 'z', sizeBytes: 2, sha256: '2' },
      { path: 'a', sizeBytes: 1, sha256: '1' },
    ],
  });
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.generatedAt, '2026-07-26T20:00:00.000Z');
  assert.equal(manifest.commitSha, 'abc123');
  assert.deepEqual(manifest.summary, { files: 6, snapshotAreas: 1, interactionAreas: 1 });
  assert.deepEqual(manifest.files.map((file) => file.path), ['a', 'z']);

  const defaults = createPlatformEvidenceManifest({ paths: [] });
  assert.equal(defaults.generatedAt, '');
  assert.equal(defaults.commitSha, '');
});

test('passes the pull request head sha to the evidence manifest', () => {
  const packager = readFileSync('scripts/package-platform-evidence.mjs', 'utf8');
  const workflow = readFileSync('.github/workflows/player-browser.yml', 'utf8');
  assert.match(packager, /process\.env\.COMMIT_SHA \|\| process\.env\.GITHUB_SHA/);
  assert.match(workflow, /COMMIT_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
});
