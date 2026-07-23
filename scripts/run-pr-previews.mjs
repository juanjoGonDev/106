import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import process from 'node:process';

const generateGif = process.argv.includes('--gif');
const outputDirectory = '.tmp/pr-previews';

rmSync(outputDirectory, { recursive: true, force: true });
mkdirSync(outputDirectory, { recursive: true });

const playwright = spawnSync(process.execPath, ['scripts/run-playwright.mjs'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PR_VISUAL_CAPTURE: '1',
    PR_VISUAL_GIF: generateGif ? '1' : '0',
  },
  stdio: 'inherit',
});

if (playwright.error) throw playwright.error;
if (playwright.status !== 0) process.exit(playwright.status ?? 1);

if (generateGif) {
  const gif = spawnSync(process.execPath, ['scripts/create-preview-gif.mjs'], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });
  if (gif.error) throw gif.error;
  if (gif.status !== 0) process.exit(gif.status ?? 1);
}

process.stdout.write(`PR visual evidence generated in ${outputDirectory}. Attach it to the PR; do not commit it.\n`);
