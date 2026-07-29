import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
const runner = readFileSync('scripts/run-supabase-ci.sh', 'utf8');
const playwrightConfig = readFileSync('playwright.config.js', 'utf8');
const suites = [
  'security',
  'ready-flow',
  'gameplay-core',
  'gameplay-sharing',
  'auth-api',
  'auth-browser',
  'migrations',
];

function occurrences(source, value) {
  return source.split(value).length - 1;
}

function jobBlock(name, nextName) {
  const start = workflow.indexOf(`  ${name}:`);
  const end = workflow.indexOf(`\n  ${nextName}:`, start);
  return workflow.slice(start, end < 0 ? workflow.length : end);
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
    expect(workflow).toContain('max-parallel: 7');
    expect(workflow).toContain(
      'suite: [security, ready-flow, gameplay-core, gameplay-sharing, auth-api, auth-browser, migrations]',
    );
  });

  it('runs one isolated local stack per domain and aggregates the matrix result', () => {
    expect(workflow).toContain('bash scripts/run-supabase-ci.sh "${{ matrix.suite }}"');
    expect(workflow).toContain('supabase=${{ needs.supabase-integration.result }}');
    expect(workflow).toContain('supabase-local-diagnostics-${{ matrix.suite }}-${{ github.run_id }}');
    expect(workflow).toContain("matrix.suite == 'gameplay-sharing'");

    for (const suite of suites) {
      expect(runner).toContain(`${suite})`);
    }
  });

  it('isolates the exact-deadline ready flow from security cleanup', () => {
    expect(runner).toMatch(/run_security_suite\(\)[\s\S]*?^}/mu);
    expect(runner).toMatch(/run_ready_flow_suite\(\) \{\n  node scripts\/test-ready-flow-local\.mjs\n}/u);

    const securitySuite = runner.match(/run_security_suite\(\) \{([\s\S]*?)\n}/u)?.[1] ?? '';
    expect(securitySuite).not.toContain('test-ready-flow-local.mjs');
  });

  it('avoids dependency installation in isolated Supabase runners', () => {
    const block = jobBlock('supabase-integration', 'quality-gate');
    expect(block).not.toContain('pnpm install');
    expect(block).not.toContain('cache: pnpm');
    expect(block).toContain("if: matrix.suite == 'auth-browser'");
    expect(block).toContain('Set up pnpm for live browser suite');
    expect(occurrences(block, 'pnpm/action-setup@')).toBe(1);
  });

  it('uses the direct Node server for the live browser suite', () => {
    expect(playwrightConfig).toContain(
      "const webServerCommand = process.env.PLAYWRIGHT_WEB_SERVER_COMMAND || 'pnpm dev';",
    );
    expect(playwrightConfig).toContain('command: webServerCommand');
    expect(runner).toContain("export PLAYWRIGHT_WEB_SERVER_COMMAND='node scripts/serve.mjs'");
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
