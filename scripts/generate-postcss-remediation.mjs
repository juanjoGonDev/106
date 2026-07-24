import { readFileSync, writeFileSync } from 'node:fs';

const workspacePath = new URL('../pnpm-workspace.yaml', import.meta.url);
const workspace = readFileSync(workspacePath, 'utf8').trimEnd();

if (/^overrides:/m.test(workspace)) {
  throw new Error('pnpm-workspace.yaml already defines overrides; update the remediation generator explicitly.');
}

writeFileSync(workspacePath, `${workspace}\n\noverrides:\n  postcss: 8.5.19\n`);
