import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
const runner = readFileSync('scripts/run-supabase-ci.sh', 'utf8');
const suites = ['security', 'gameplay', 'auth-api', 'auth-browser', 'migrations'];

function occurrences(source, value) {
  return source.split(value).length - 1;
}

describe('fast parallel Supabase CI', () => {
  it('keeps every executable quality job bounded to three minutes or less', () => {
    const timeouts = [...workflow.matchAll(/timeout-minutes:\s*(\d+)/gu)]
      .map((match) => Number(match[1]));

    expect(timeouts.length).toBeGreaterThanOrEqual(7);
    expect(Math.max(...timeouts)).toBeLessThanOrEqual(3);
  });

  it('starts independent quality jobs immediately instead of serializing behind build', () => {
    expect(workflow).not.toMatch(/^\s{4}needs:\s*build\s*$/gmu);
    expect(workflow).toContain('max-parallel: 5');
    expect(workflow).toContain('suite: [security, gameplay, auth-api, auth-browser, migrations]');
  });

  it('runs one isolated local stack per domain and aggregates the matrix result', () => {
    expect(workflow).toContain('bash scripts/run-supabase-ci.sh "${{ matrix.suite }}"');
    expect(workflow).toContain('supabase=${{ needs.supabase-integration.result }}');
    expect(workflow).toContain('supabase-local-diagnostics-${{ matrix.suite }}-${{ github.run_id }}');
    expect(workflow).toContain("matrix.suite == 'gameplay'");

    for (const suite of suites) {
      expect(runner).toContain(`${suite})`);
    }
  });

  it('does not reintroduce the six-minute monolithic journey', () => {
    expect(runner).not.toContain('pnpm test:supabase');
    expect(runner).not.toContain('Run complete API and persistence journey');
    expect(runner).not.toContain('Run real browser authentication journeys');
    expect(runner).not.toContain('Re-run API smoke checks after database rebuild');
    expect(occurrences(runner, 'supabase start')).toBe(1);
  });

  it('assigns every maintained local journey to exactly one domain', () => {
    const scripts = [
      'test-database-permissions-local.mjs',
      'test-input-security-local.mjs',
      'test-migration-compatibility-local.mjs',
      'test-supabase-local.mjs',
      'test-attempt-reservations-local.mjs',
      'test-daily-attempt-limits-local.mjs',
      'test-verified-email-daily-bonus-local.mjs',
      'test-mobile-touch-local.mjs',
      'test-ready-flow-local.mjs',
      'test-trophies-local.mjs',
      'test-player-share-local.mjs',
      'test-social-share-local.mjs',
      'test-account-auth-local.mjs',
      'test-verified-email-reward-local.mjs',
      'test-account-auth-concurrency-local.mjs',
    ];

    for (const script of scripts) {
      expect(occurrences(runner, script), script).toBe(1);
    }
  });

  it('keeps the shell router syntactically valid', () => {
    const result = spawnSync('bash', ['-n', 'scripts/run-supabase-ci.sh'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });

    expect(result.status, result.stderr).toBe(0);
  });
});
