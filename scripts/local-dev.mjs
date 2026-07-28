import { spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import {
  LOCAL_FUNCTION_ENV_PATH,
  localAccountUrl,
  localDevelopmentMode,
  localFunctionEnvironmentSource,
  localFunctionHealthUrl,
  localFunctionServeArguments,
  localStartupPlan,
  localWebHealthUrl,
} from './local-dev-plan.mjs';

const mode = localDevelopmentMode(process.argv.slice(2));
const useShell = process.platform === 'win32';
const children = new Set();
let shuttingDown = false;

function commandLabel(command, args) {
  return [command, ...args].join(' ');
}

function run(command, args, { allowFailure = false } = {}) {
  process.stdout.write(`\n> ${commandLabel(command, args)}\n`);
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    shell: useShell,
    stdio: 'inherit',
  });
  if (result.error && !allowFailure) throw result.error;
  if ((result.status ?? 1) !== 0 && !allowFailure) {
    throw new Error(`${commandLabel(command, args)} exited with status ${result.status ?? 'unknown'}.`);
  }
}

function isStackRunning() {
  const result = spawnSync('supabase', ['status', '-o', 'env'], {
    cwd: process.cwd(),
    env: process.env,
    shell: useShell,
    stdio: 'ignore',
  });
  return !result.error && result.status === 0;
}

function start(command, args) {
  process.stdout.write(`\n> ${commandLabel(command, args)}\n`);
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: process.env,
    shell: useShell,
    stdio: 'inherit',
  });
  children.add(child);
  child.once('exit', (code, signal) => {
    children.delete(child);
    if (shuttingDown) return;
    const detail = signal ? `signal ${signal}` : `status ${code ?? 'unknown'}`;
    process.stderr.write(`\n${commandLabel(command, args)} stopped unexpectedly (${detail}).\n`);
    shutdown(1);
  });
  child.once('error', (error) => {
    if (shuttingDown) return;
    process.stderr.write(`\nCould not start ${command}: ${error.message}\n`);
    shutdown(1);
  });
  return child;
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill('SIGTERM');
  process.exitCode = exitCode;
}

async function waitFor(url, options = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${url} did not become ready: ${lastError?.message ?? 'unknown error'}`);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

try {
  await mkdir(dirname(LOCAL_FUNCTION_ENV_PATH), { recursive: true });
  await writeFile(LOCAL_FUNCTION_ENV_PATH, localFunctionEnvironmentSource(), { encoding: 'utf8', mode: 0o600 });

  const plan = localStartupPlan({
    resetDatabase: mode.resetDatabase,
    stackRunning: isStackRunning(),
  });
  for (const step of plan) run(step.command, [...step.args], step);

  start('supabase', [...localFunctionServeArguments()]);
  start('pnpm', ['dev']);

  await Promise.all([
    waitFor(localFunctionHealthUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3000' },
      body: JSON.stringify({ action: 'stats' }),
    }),
    waitFor(localWebHealthUrl()),
  ]);

  process.stdout.write(`\n✓ Local Minuto 106 is ready: ${localAccountUrl()}\n`);
  process.stdout.write('Press Ctrl+C to stop the web and Edge Function processes.\n');
} catch (error) {
  process.stderr.write(`\nLocal startup failed: ${error instanceof Error ? error.message : String(error)}\n`);
  shutdown(1);
}
