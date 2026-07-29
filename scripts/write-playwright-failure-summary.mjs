import { readFileSync } from 'node:fs';

import { playwrightFailureSlug } from './playwright-failure-summary.mjs';

function readText(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

function readJson(path) {
  try {
    return JSON.parse(readText(path)) || {};
  } catch {
    return {};
  }
}

const reportPath = process.argv[2] || 'playwright-results.json';
const outputPath = process.argv[3] || 'playwright-output.txt';
const slug = playwrightFailureSlug(readJson(reportPath), readText(outputPath));
process.stdout.write(`slug=${slug}\n`);
