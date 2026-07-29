import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
const runner = readFileSync('scripts/run-supabase-ci.sh', 'utf8');
const playwrightConfig = readFileSync('playwright.config.js', 'utf8');
const playwrightRunner = readFileSync('scripts/run-playwright.mjs', 'utf8');
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

function shellFunctionBlock(name) {
  const start = runner.indexOf(`${name}() {`);
  const end = runner.indexOf('\n}', start);
  return runner.slice(start, end < 0 ? runner.length : end + 2);
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
    const securitySuite = shellFunctionBlock('run_security_suite');
    const readyFlowSuite = shellFunctionBlock('run_ready_flow_suite');

    expect(securitySuite).not.toContain('test-ready-flow-local.mjs');
    expect(readyFlowSuite).toContain('node scripts/test-ready-flow-local.mjs');
  });

  it('warms only the Edge Functions required by each domain', () => {
    const warmup = shellFunctionBlock('warm_edge_functions_for_suite');
    const authApiWarmup = shellFunctionBlock('warm_auth_api_functions');

    expect(warmup).toContain('auth-api)');
    expect(warmup).toContain('warm_auth_api_functions');
    expect(warmup).toContain('auth-browser)');
    expect(warmup).toContain('functions/v1/account-auth');
    expect(warmup).toContain('ready-flow)');
    expect(warmup).toContain('functions/v1/game-ready-api');
    expect(warmup).toContain('gameplay-sharing|migrations)');
    expect(warmup).toContain('functions/v1/game-api');
    expect(warmup).not.toContain('game, player-context and league Edge Functions are warm');

    expect(authApiWarmup).toContain('functions/v1/account-auth');
    expect(authApiWarmup).toContain('functions/v1/game-api');
    expect(authApiWarmup).toContain('account_auth_pid=$!');
    expect(authApiWarmup).toContain('game_api_pid=$!');
    expect(authApiWarmup).toContain('wait "$account_auth_pid" || failed=1');
    expect(authApiWarmup).toContain('wait "$game_api_pid" || failed=1');
    expect(authApiWarmup.indexOf('account_auth_pid=$!')).toBeLessThan(
      authApiWarmup.indexOf('wait "$account_auth_pid"'),
    );
    expect(authApiWarmup.indexOf('game_api_pid=$!')).toBeLessThan(
      authApiWarmup.indexOf('wait "$game_api_pid"'),
    );
  });

  it('allows cold Edge compilation to complete in a bounded probe', () => {
    const probe = shellFunctionBlock('probe_edge_function');
    const wait = shellFunctionBlock('wait_for_edge_functions');

    expect(runner).toContain('readonly EDGE_WARMUP_ATTEMPTS=3');
    expect(runner).toContain('readonly EDGE_WARMUP_TIMEOUT_SECONDS=30');
    expect(probe).not.toContain('--fail');
    expect(probe).toContain('--connect-timeout 2');
    expect(probe).toContain('--max-time "$EDGE_WARMUP_TIMEOUT_SECONDS"');
    expect(probe).toContain('[[ "$status" -ge 200 && "$status" -lt 500 ]]');
    expect(wait).toContain('seq 1 "$EDGE_WARMUP_ATTEMPTS"');
  });

  it('keeps full local cleanup without spending CI budget on ephemeral containers', () => {
    const cleanup = shellFunctionBlock('cleanup');

    expect(cleanup).toContain('${GITHUB_ACTIONS:-false}');
    expect(cleanup).toContain('supabase stop --no-backup');
    expect(cleanup).toContain('kill "$PLAYWRIGHT_PREP_PID"');
    expect(cleanup).toContain('rm -f supabase/functions/.env .supabase-functions.pid playwright-prepare.log');
  });

  it('removes stale Supabase containers only on ephemeral CI before startup', () => {
    const preflight = shellFunctionBlock('clear_stale_ci_supabase_containers');
    const preflightCall = runner.indexOf('\nclear_stale_ci_supabase_containers\n');
    const start = runner.indexOf('\nsupabase start \\\n');

    expect(preflight).toContain('${GITHUB_ACTIONS:-false}');
    expect(preflight).toContain("docker ps --all --quiet --filter 'name=supabase_'");
    expect(preflight).toContain('docker rm --force "${stale_containers[@]}"');
    expect(preflightCall).toBeGreaterThan(-1);
    expect(start).toBeGreaterThan(-1);
    expect(preflightCall).toBeLessThan(start);
  });

  it('defers migration warm-up until after the reset it validates', () => {
    const migrationSuite = shellFunctionBlock('run_migration_suite');

    expect(runner).toContain('if [[ "$SUITE" == \'migrations\' ]]; then');
    expect(runner).toContain('migrations defers Edge Function warm-up until after database reset');
    expect(migrationSuite).toContain('supabase db reset');
    expect(migrationSuite.indexOf('supabase db reset')).toBeLessThan(
      migrationSuite.indexOf('wait_for_edge_functions'),
    );
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

  it('prepares the live browser runtime concurrently without weakening diagnostics', () => {
    const prepare = shellFunctionBlock('prepare_auth_browser_runtime');
    const wait = shellFunctionBlock('wait_for_auth_browser_runtime');
    const authBrowser = shellFunctionBlock('run_auth_browser_suite');
    const prepareCall = runner.indexOf('\nprepare_auth_browser_runtime\n');
    const start = runner.indexOf('\nsupabase start \\\n');

    expect(prepare).toContain('PLAYWRIGHT_PREPARE_ONLY=1 PLAYWRIGHT_DISABLE_VIDEO=1');
    expect(prepare).toContain('node scripts/run-playwright.mjs > playwright-prepare.log 2>&1 &');
    expect(wait).toContain('wait "$PLAYWRIGHT_PREP_PID"');
    expect(wait).toContain('cat playwright-prepare.log');
    expect(prepareCall).toBeGreaterThan(-1);
    expect(prepareCall).toBeLessThan(start);
    expect(authBrowser.indexOf('wait_for_auth_browser_runtime')).toBeLessThan(
      authBrowser.indexOf('node scripts/run-playwright.mjs'),
    );
    expect(authBrowser).toContain('export PLAYWRIGHT_DISABLE_VIDEO=1');
    expect(authBrowser).toContain('export PLAYWRIGHT_RUNTIME_PREPARED=1');
    expect(playwrightRunner).toContain("const prepareOnly = process.env.PLAYWRIGHT_PREPARE_ONLY === '1'");
    expect(playwrightRunner).toContain("const runtimePrepared = process.env.PLAYWRIGHT_RUNTIME_PREPARED === '1'");
    expect(playwrightRunner).toContain('if (!runtimePrepared && !videoDisabled)');
    expect(playwrightConfig).toContain("const videoDisabled = process.env.PLAYWRIGHT_DISABLE_VIDEO === '1'");
    expect(playwrightConfig).toContain("video: visualCapture || videoDisabled ? 'off' : 'retain-on-failure'");
    expect(playwrightConfig).toContain("trace: 'retain-on-failure'");
    expect(playwrightConfig).toContain("screenshot: 'only-on-failure'");
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