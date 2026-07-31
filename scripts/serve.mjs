import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildRuntimeConfig } from './runtime-config.mjs';

const root = fileURLToPath(new URL('../public', import.meta.url));
const port = Number(process.env.PORT ?? 3000);
const mime = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const cleanPublicRoute = /^(?:\/player\/[^/]+(?:\/(?:achievements|trophies))?|\/ligas\/[A-Z0-9]{6})\/?$/i;

function parseEnvironment(source) {
  const values = {};
  for (const line of String(source ?? '').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(?:"([^"]*)"|'([^']*)'|(.*))$/);
    if (match) values[match[1]] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  return values;
}

function localSupabaseEnvironment() {
  if (process.env.SUPABASE_PUBLISHABLE_KEY) return {};
  const result = spawnSync('supabase', ['status', '-o', 'env'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 10_000,
  });
  if (result.error || result.status !== 0) return {};
  const values = parseEnvironment(result.stdout);
  const supabaseUrl = values.API_URL || values.SUPABASE_URL;
  const publishableKey = values.ANON_KEY || values.PUBLISHABLE_KEY;
  if (!supabaseUrl || !publishableKey) return {};
  return {
    SUPABASE_URL: supabaseUrl,
    SUPABASE_FUNCTIONS_URL: `${supabaseUrl.replace(/\/$/, '')}/functions/v1/game-api`,
    SUPABASE_PUBLISHABLE_KEY: publishableKey,
  };
}

const runtimeConfig = buildRuntimeConfig({
  ...process.env,
  ...localSupabaseEnvironment(),
  PUBLIC_SITE_URL: process.env.PUBLIC_SITE_URL || `http://localhost:${port}`,
});
const playerRadarRuntime = await readFile(join(root, 'player-radar-model.js'), 'utf8');
const runtimeConfigSource = `window.__MINUTO106_CONFIG__=${JSON.stringify(runtimeConfig)};\n${playerRadarRuntime}`;

async function sendFile(response, path, status = 200) {
  const content = await readFile(path);
  response.writeHead(status, { 'content-type': mime[extname(path).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  response.end(content);
}

function sendRuntimeConfig(response) {
  response.writeHead(200, {
    'content-type': 'text/javascript; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(runtimeConfigSource);
}

createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
  if (pathname === '/config.js') {
    sendRuntimeConfig(response);
    return;
  }
  try {
    const relative = normalize(pathname).replace(/^([/\\])+/, '');
    let file = join(root, relative || 'index.html');
    if (!file.startsWith(root)) throw new Error('Invalid path');
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    await sendFile(response, file);
  } catch {
    try {
      const fallback = cleanPublicRoute.test(pathname) ? '404.html' : 'index.html';
      await sendFile(response, join(root, fallback));
    } catch {
      response.writeHead(404).end('Not found');
    }
  }
}).listen(port, () => {
  const authMode = runtimeConfig.supabasePublishableKey ? 'Supabase Auth activo' : 'Supabase Auth sin configurar';
  console.log(`Minuto 106 disponible en http://localhost:${port} · ${authMode}`);
});
