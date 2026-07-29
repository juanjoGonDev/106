import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import {
  AUTH_EMAIL_TEMPLATES,
  buildHostedAuthEmailConfig,
  renderAuthEmailTemplate,
} from './auth-email-templates.mjs';

const argumentsSet = new Set(process.argv.slice(2));
const checkOnly = argumentsSet.has('--check');
const hostedJson = argumentsSet.has('--hosted-json');
const supportedArguments = new Set(['--check', '--hosted-json']);
const unknownArguments = [...argumentsSet].filter((argument) => !supportedArguments.has(argument));

if (unknownArguments.length > 0) {
  throw new Error(`Unsupported arguments: ${unknownArguments.join(', ')}`);
}
if (checkOnly && hostedJson) {
  throw new Error('Use either --check or --hosted-json, not both.');
}

function isCurrent(template, expected) {
  try {
    return readFileSync(template.outputPath, 'utf8') === expected;
  } catch {
    return false;
  }
}

if (hostedJson) {
  process.stdout.write(`${JSON.stringify(buildHostedAuthEmailConfig(), null, 2)}\n`);
} else {
  const staleFiles = [];
  for (const template of AUTH_EMAIL_TEMPLATES) {
    const expected = renderAuthEmailTemplate(template);
    if (checkOnly) {
      if (!isCurrent(template, expected)) staleFiles.push(template.outputPath);
      continue;
    }

    mkdirSync(dirname(template.outputPath), { recursive: true });
    writeFileSync(template.outputPath, expected, 'utf8');
  }

  if (staleFiles.length > 0) {
    throw new Error(`Generated authentication email templates are stale:\n${staleFiles.map((path) => `- ${path}`).join('\n')}\nRun pnpm build:auth-emails.`);
  }

  process.stdout.write(checkOnly
    ? `Authentication email templates are current (${AUTH_EMAIL_TEMPLATES.length}).\n`
    : `Generated ${AUTH_EMAIL_TEMPLATES.length} authentication email templates.\n`);
}
