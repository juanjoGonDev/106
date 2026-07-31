import { readFile, writeFile } from 'node:fs/promises';

import { buildRuntimeConfig, validateRuntimeConfig } from './runtime-config.mjs';

const config = buildRuntimeConfig(process.env);
const validationErrors = validateRuntimeConfig(config);
const radarRuntime = await readFile(new URL('../public/player-radar-model.js', import.meta.url), 'utf8');
const configSource = `window.__MINUTO106_CONFIG__ = ${JSON.stringify(config, null, 2)};\n\n${radarRuntime}`;

await writeFile(new URL('../public/config.js', import.meta.url), configSource, 'utf8');

if (validationErrors.length > 0) {
  console.warn(`Generated public/config.js with warnings:\n- ${validationErrors.join('\n- ')}`);
} else {
  console.log(`Generated public/config.js for ${config.apiBaseUrl}`);
}
