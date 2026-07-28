import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  filesBelow,
  mergePlatformEvidenceFragments,
} from '../scripts/platform-evidence-fragments.mjs';

function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'minuto106-evidence-'));
  return {
    root,
    fragments: join(root, 'fragments'),
    output: join(root, 'output'),
    cleanup() { rmSync(root, { recursive: true, force: true }); },
  };
}

function file(path, content = path) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
}

test('lists nested regular files deterministically and ignores missing, marker and symbolic entries', () => {
  const state = workspace();
  try {
    assert.deepEqual(filesBelow(join(state.root, 'missing')), []);
    mkdirSync(join(state.root, 'tree', 'nested'), { recursive: true });
    writeFileSync(join(state.root, 'tree', 'z.png'), 'z');
    writeFileSync(join(state.root, 'tree', 'nested', 'a.webm'), 'a');
    writeFileSync(join(state.root, 'tree', '.fragment-desktop-1'), 'marker');
    writeFileSync(join(state.root, 'tree', 'nested', '.fragment-gif-desktop-1'), 'marker');
    symlinkSync(join(state.root, 'tree', 'z.png'), join(state.root, 'tree', 'linked.png'));
    assert.deepEqual(filesBelow(join(state.root, 'tree')), ['nested/a.webm', 'z.png']);
  } finally {
    state.cleanup();
  }
});

test('rejects missing, absent and marker-only fragment inventories', () => {
  const state = workspace();
  try {
    assert.throws(
      () => mergePlatformEvidenceFragments({ fragmentsDirectory: state.fragments, outputDirectory: state.output }),
      /Missing platform evidence fragments directory/,
    );

    mkdirSync(state.fragments, { recursive: true });
    writeFileSync(join(state.fragments, 'not-a-fragment.txt'), 'ignored');
    assert.throws(
      () => mergePlatformEvidenceFragments({ fragmentsDirectory: state.fragments, outputDirectory: state.output }),
      /No platform evidence fragments were downloaded/,
    );

    mkdirSync(join(state.fragments, 'fragment-empty'));
    writeFileSync(join(state.fragments, 'fragment-empty', '.fragment-empty'), 'marker');
    assert.throws(
      () => mergePlatformEvidenceFragments({ fragmentsDirectory: state.fragments, outputDirectory: state.output }),
      /contained no files/,
    );
  } finally {
    state.cleanup();
  }
});

test('merges unique fragment trees, clears stale output and returns sorted paths', () => {
  const state = workspace();
  try {
    file(join(state.fragments, 'fragment-b', 'nested', 'b.webm'), 'video');
    file(join(state.fragments, 'fragment-a', 'a.png'), 'image');
    file(join(state.output, 'stale.txt'), 'stale');

    assert.deepEqual(
      mergePlatformEvidenceFragments({ fragmentsDirectory: state.fragments, outputDirectory: state.output }),
      ['a.png', 'nested/b.webm'],
    );
    assert.equal(readFileSync(join(state.output, 'a.png'), 'utf8'), 'image');
    assert.equal(readFileSync(join(state.output, 'nested', 'b.webm'), 'utf8'), 'video');
    assert.equal(existsSync(join(state.output, 'stale.txt')), false);
  } finally {
    state.cleanup();
  }
});

test('rejects collisions instead of silently overwriting evidence from another shard', () => {
  const state = workspace();
  try {
    file(join(state.fragments, 'fragment-a', 'same.png'), 'a');
    file(join(state.fragments, 'fragment-b', 'same.png'), 'b');
    assert.throws(
      () => mergePlatformEvidenceFragments({ fragmentsDirectory: state.fragments, outputDirectory: state.output }),
      /Duplicate platform evidence file same\.png from fragment-a and fragment-b/,
    );
  } finally {
    state.cleanup();
  }
});
