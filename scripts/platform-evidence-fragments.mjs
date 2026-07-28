import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';

function normalizedRelativePath(root, path) {
  return relative(root, path).replaceAll('\\', '/');
}

export function filesBelow(directory) {
  if (!existsSync(directory)) return [];
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
      if (entry.isFile()) files.push(normalizedRelativePath(directory, path));
    }
  }
  return files.sort();
}

export function mergePlatformEvidenceFragments({ fragmentsDirectory, outputDirectory }) {
  if (!existsSync(fragmentsDirectory)) {
    throw new Error(`Missing platform evidence fragments directory: ${fragmentsDirectory}`);
  }

  const fragmentNames = readdirSync(fragmentsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (!fragmentNames.length) throw new Error('No platform evidence fragments were downloaded.');

  rmSync(outputDirectory, { recursive: true, force: true });
  mkdirSync(outputDirectory, { recursive: true });
  const owners = new Map();

  for (const fragmentName of fragmentNames) {
    const fragmentDirectory = join(fragmentsDirectory, fragmentName);
    for (const path of filesBelow(fragmentDirectory)) {
      const existingOwner = owners.get(path);
      if (existingOwner) {
        throw new Error(`Duplicate platform evidence file ${path} from ${existingOwner} and ${fragmentName}.`);
      }
      const source = join(fragmentDirectory, path);
      const destination = join(outputDirectory, path);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(source, destination);
      owners.set(path, fragmentName);
    }
  }

  const paths = [...owners.keys()].sort();
  if (!paths.length) throw new Error('Downloaded platform evidence fragments contained no files.');
  return paths;
}
