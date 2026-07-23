import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

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

async function sendFile(response, path, status = 200) {
  const content = await readFile(path);
  response.writeHead(status, { 'content-type': mime[extname(path).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  response.end(content);
}

createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
  try {
    const relative = normalize(pathname).replace(/^([/\\])+/, '');
    let file = join(root, relative || 'index.html');
    if (!file.startsWith(root)) throw new Error('Invalid path');
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    await sendFile(response, file);
  } catch {
    try {
      const fallback = /^\/player\/[^/]+(?:\/(?:achievements|trophies))?\/?$/i.test(pathname) ? '404.html' : 'index.html';
      await sendFile(response, join(root, fallback));
    } catch {
      response.writeHead(404).end('Not found');
    }
  }
}).listen(port, () => console.log(`Minuto 106 disponible en http://localhost:${port}`));