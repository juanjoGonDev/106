import { readFileSync, writeFileSync } from 'node:fs';

const manifestPath = new URL('../package.json', import.meta.url);
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

manifest.pnpm = {
  ...(manifest.pnpm ?? {}),
  overrides: {
    ...(manifest.pnpm?.overrides ?? {}),
    postcss: '8.5.19',
  },
};

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
