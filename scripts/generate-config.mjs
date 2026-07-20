import { writeFile } from 'node:fs/promises';

const apiBaseUrl = String(process.env.SUPABASE_FUNCTIONS_URL ?? '').trim().replace(/\/$/, '');
const turnstileSiteKey = String(process.env.TURNSTILE_SITE_KEY ?? '').trim();
const config = {
  apiBaseUrl: apiBaseUrl || 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/game-api',
  turnstileSiteKey,
};

await writeFile(
  new URL('../public/config.js', import.meta.url),
  `window.__MINUTO106_CONFIG__ = ${JSON.stringify(config, null, 2)};\n`,
  'utf8',
);

console.log(`Generated public/config.js for ${config.apiBaseUrl}`);
