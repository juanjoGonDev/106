import { buildRuntimeConfig, validateRuntimeConfig } from './runtime-config.mjs';

const config = buildRuntimeConfig(process.env);
const errors = validateRuntimeConfig(config);

if (errors.length > 0) {
  for (const error of errors) console.error(`Runtime configuration error: ${error}`);
  process.exit(1);
}

console.log(`Runtime configuration is valid for ${config.publicSiteUrl}.`);
