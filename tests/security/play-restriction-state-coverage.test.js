import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('play restriction state coverage', () => {
  it('keeps the isolated restriction decision module at 100 percent coverage', () => {
    const result = spawnSync(process.execPath, [
      '--test',
      '--experimental-test-coverage',
      '--test-coverage-include=public/play-restriction-state.js',
      '--test-coverage-lines=100',
      '--test-coverage-functions=100',
      '--test-coverage-branches=100',
      'tests/play-restriction-state.node-test.js',
    ], { encoding: 'utf8' });

    expect(`${result.stdout}\n${result.stderr}`).not.toContain('coverage threshold for');
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  });
});
