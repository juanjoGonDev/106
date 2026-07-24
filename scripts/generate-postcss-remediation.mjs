import { readFileSync, writeFileSync } from 'node:fs';

const workspacePath = new URL('../pnpm-workspace.yaml', import.meta.url);
const workspace = readFileSync(workspacePath, 'utf8').trimEnd();

if (/^(overrides|minimumReleaseAgeExclude):/m.test(workspace)) {
  throw new Error('pnpm-workspace.yaml already defines remediation settings; update the generator explicitly.');
}

writeFileSync(workspacePath, `${workspace}\n\n# Security exception for GHSA-r28c-9q8g-f849. Remove after the normal maturity window.\nminimumReleaseAgeExclude:\n  - postcss@8.5.19\n\noverrides:\n  postcss: 8.5.19\n`);
