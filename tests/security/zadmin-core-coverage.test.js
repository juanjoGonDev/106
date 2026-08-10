import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('zadmin security core coverage', () => {
  it('keeps isolated admin decisions at 100% lines, functions and branches', () => {
    const result = spawnSync(process.execPath, [
      '--test',
      '--experimental-test-coverage',
      '--test-coverage-include=supabase/functions/_shared/zadmin-core.js',
      '--test-coverage-lines=100',
      '--test-coverage-functions=100',
      '--test-coverage-branches=100',
      'tests/zadmin-core.node-test.js',
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: process.env,
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  });
});
