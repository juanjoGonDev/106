import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import process from 'node:process';
import {
  createPlatformEvidenceManifest,
  validatePlatformEvidence,
} from './platform-evidence.mjs';

const outputDirectory = resolve(process.env.PLATFORM_EVIDENCE_DIRECTORY || '.tmp/pr-previews');
const manifestPath = join(outputDirectory, 'manifest.json');

function filesBelow(directory) {
  const files = [];
  const pending = [directory];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(path);
        continue;
      }
      if (entry.isFile() && path !== manifestPath) files.push(path);
    }
  }
  return files.sort();
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

if (!existsSync(outputDirectory)) throw new Error(`Missing platform evidence directory: ${outputDirectory}`);
const absoluteFiles = filesBelow(outputDirectory);
const relativePaths = absoluteFiles.map((path) => relative(outputDirectory, path).replaceAll('\\', '/'));
const validation = validatePlatformEvidence(relativePaths);
if (validation.errors.length) {
  throw new Error(`Incomplete platform evidence:\n- ${validation.errors.join('\n- ')}`);
}

const fileMetadata = absoluteFiles.map((path) => ({
  path: relative(outputDirectory, path).replaceAll('\\', '/'),
  sizeBytes: statSync(path).size,
  sha256: sha256(path),
}));
const manifest = createPlatformEvidenceManifest({
  paths: relativePaths,
  generatedAt: new Date().toISOString(),
  commitSha: process.env.GITHUB_SHA || process.env.COMMIT_SHA || '',
  files: fileMetadata,
});
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`Validated ${manifest.summary.snapshotAreas} platform screens and ${manifest.summary.interactionAreas} recorded interaction areas. Manifest: ${manifestPath}\n`);
