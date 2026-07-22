import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { describe, expect, it } from 'vitest';

const COVERAGE_ARGUMENTS = [
  '--test',
  '--experimental-test-coverage',
  '--test-coverage-include=public/human-check-ready-flow.js',
  '--test-coverage-lines=100',
  '--test-coverage-functions=100',
  '--test-coverage-branches=100',
  'tests/human-check-ready-flow.node-test.js',
];

describe('human-check ready-flow coverage gate', () => {
  it('enforces 100% line, function, and branch coverage', () => {
    const output = execFileSync(process.execPath, COVERAGE_ARGUMENTS, {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
    });

    expect(output).toContain('human-check-ready-flow.js | 100.00 |   100.00 |  100.00');
  });
});
