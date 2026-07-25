import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import process from 'node:process';

const outputDirectory = '.tmp/pr-previews';

rmSync(outputDirectory, { recursive: true, force: true });
mkdirSync(outputDirectory, { recursive: true });

const playwright = spawnSync(process.execPath, ['scripts/run-playwright.mjs'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PR_VISUAL_CAPTURE: '1',
  },
  stdio: 'inherit',
});

if (playwright.error) throw playwright.error;
if (playwright.status !== 0) process.exit(playwright.status ?? 1);
process.stdout.write(`Complete Desktop/Mobile screenshots and animated GIF evidence generated in ${outputDirectory}. Attach them to the PR; do not commit them to the feature branch.\n`);
