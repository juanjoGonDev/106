import { spawnSync } from 'node:child_process';

const command = process.platform === 'win32' ? 'supabase.exe' : 'supabase';
const mode = process.argv[2] || 'status';
const supportedModes = new Set(['start', 'reset', 'migrate', 'status', 'stop']);

function run(args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    env: process.env,
  });

  if (options.capture) return result;
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  return result;
}

function stackIsRunning() {
  const result = run(['status'], { capture: true });
  return result.status === 0;
}

function ensureStarted() {
  if (stackIsRunning()) return;
  process.stdout.write('Supabase local no está iniciado. Arrancando contenedores…\n');
  run(['start']);
}

if (!supportedModes.has(mode)) {
  process.stderr.write(`Modo desconocido: ${mode}. Usa start, reset, migrate, status o stop.\n`);
  process.exit(1);
}

if (mode === 'start') {
  ensureStarted();
  run(['status']);
} else if (mode === 'reset') {
  ensureStarted();
  process.stdout.write('Recreando exclusivamente la base de datos local y aplicando todas las migraciones…\n');
  run(['db', 'reset', '--local']);
} else if (mode === 'migrate') {
  ensureStarted();
  process.stdout.write('Previsualizando migraciones locales pendientes sin eliminar datos…\n');
  run(['db', 'push', '--local', '--dry-run']);
  process.stdout.write('Aplicando únicamente migraciones locales pendientes…\n');
  run(['db', 'push', '--local']);
} else if (mode === 'stop') {
  run(['stop']);
} else {
  run(['status']);
}
