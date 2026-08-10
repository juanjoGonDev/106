const LOCAL_SUPABASE_URL = 'http://127.0.0.1:54321';
const LOCAL_WEB_URL = 'http://127.0.0.1:3000';
const EXCLUDED_LOCAL_SERVICES = 'studio,imgproxy,realtime,storage-api,postgres-meta,logflare,vector,supavisor';

export const LOCAL_FUNCTION_ENV_PATH = 'supabase/functions/.env';
export const LOCAL_FUNCTION_ENV = Object.freeze([
  ['HASH_PEPPER', 'local-dev-only-pepper-106-do-not-use-in-production'],
  ['ALLOWED_ORIGINS', 'http://127.0.0.1:3000,http://localhost:3000'],
  ['TURNSTILE_SECRET_KEY', ''],
]);

export function localFunctionEnvironmentSource(entries = LOCAL_FUNCTION_ENV) {
  return `${entries.map(([key, value]) => `${key}=${value}`).join('\n')}\n`;
}

export function localDevelopmentMode(argumentsList = []) {
  const flags = new Set(argumentsList);
  const unknown = [...flags].filter((flag) => flag !== '--reset');
  if (unknown.length) {
    throw new Error(`Unknown local development option: ${unknown.join(', ')}`);
  }
  return Object.freeze({ resetDatabase: flags.has('--reset') });
}

export function localSupabaseStartArguments() {
  return Object.freeze(['start', '-x', EXCLUDED_LOCAL_SERVICES]);
}

export function localStartupPlan({ resetDatabase, stackRunning }) {
  if (resetDatabase) {
    return Object.freeze([
      Object.freeze({ command: 'supabase', args: Object.freeze(['stop', '--no-backup']), allowFailure: true }),
      Object.freeze({ command: 'supabase', args: localSupabaseStartArguments(), allowFailure: false }),
      Object.freeze({ command: 'supabase', args: Object.freeze(['db', 'reset', '--local']), allowFailure: false }),
    ]);
  }

  if (stackRunning) return Object.freeze([]);
  return Object.freeze([
    Object.freeze({ command: 'supabase', args: localSupabaseStartArguments(), allowFailure: false }),
  ]);
}

export function localFunctionServeArguments() {
  return Object.freeze(['functions', 'serve', '--env-file', LOCAL_FUNCTION_ENV_PATH]);
}

export function localFunctionHealthUrl() {
  return `${LOCAL_SUPABASE_URL}/functions/v1/game-api`;
}

export function localZadminHealthUrl() {
  return `${LOCAL_SUPABASE_URL}/functions/v1/zadmin-api`;
}

export function localWebHealthUrl() {
  return `${LOCAL_WEB_URL}/config.js`;
}

export function localAccountUrl() {
  return `${LOCAL_WEB_URL}/cuenta.html`;
}

export function localZadminUrl() {
  return `${LOCAL_WEB_URL}/zadmin/`;
}
