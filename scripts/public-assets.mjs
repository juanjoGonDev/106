import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';

export const MEDIA_EXTENSIONS = new Set(['.avif', '.gif', '.ico', '.jpeg', '.jpg', '.otf', '.png', '.svg', '.ttf', '.webp', '.woff', '.woff2']);
const TEXT_EXTENSIONS = new Set(['.css', '.html', '.js', '.json', '.md', '.mjs', '.ts', '.yaml', '.yml']);
const IGNORED_DIRECTORY_NAMES = new Set(['.git', '.tmp', 'node_modules', 'playwright-report', 'test-results']);

export function normalizeRepositoryPath(root, absolutePath) {
  return relative(root, absolutePath).replaceAll('\\', '/');
}

export function walkRepository(root, directory = root) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORED_DIRECTORY_NAMES.has(entry.name)) continue;
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkRepository(root, absolute));
      continue;
    }
    if (entry.isFile()) files.push(absolute);
  }
  return files;
}

function hasMediaExtension(value) {
  const clean = value.split(/[?#]/, 1)[0].toLowerCase();
  return MEDIA_EXTENSIONS.has(extname(clean));
}

function unquoteCssUrl(value) {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value.at(-1);
  if (first === '"' && last === '"') return value.slice(1, -1).trim();
  if (first === "'" && last === "'") return value.slice(1, -1).trim();
  return value;
}

function extractCssUrlReferences(content) {
  const references = [];
  const lower = content.toLowerCase();
  let cursor = 0;
  while (cursor < content.length) {
    const start = lower.indexOf('url(', cursor);
    if (start < 0) break;
    const valueStart = start + 4;
    const end = content.indexOf(')', valueStart);
    if (end < 0) break;
    const value = unquoteCssUrl(content.slice(valueStart, end).trim());
    if (value) references.push(value);
    cursor = end + 1;
  }
  return references;
}

export function extractAssetReferences(content) {
  const references = new Set(extractCssUrlReferences(content));
  const expressions = [
    /(?:src|href|content)\s*=\s*["']([^"']+)["']/gi,
    /"src"\s*:\s*"([^"]+)"/gi,
    /["']((?:\.{0,2}\/|\/)[^"'`]+?\.(?:avif|gif|ico|jpe?g|otf|png|svg|ttf|webp|woff2?)(?:[?#][^"'`]*)?)["']/gi,
  ];
  for (const expression of expressions) {
    for (const match of content.matchAll(expression)) {
      const value = String(match[1]).trim();
      if (hasMediaExtension(value)) references.add(value);
    }
  }
  return [...references].filter(hasMediaExtension);
}

function stripQueryAndHash(value) {
  return value.split(/[?#]/, 1)[0];
}

export function resolveAssetReference(root, sourcePath, reference) {
  const raw = String(reference ?? '').trim();
  if (!raw || raw.includes('${') || /^(?:data:|blob:|https?:|mailto:|javascript:|#)/i.test(raw)) return null;
  let path = stripQueryAndHash(raw);
  try {
    path = decodeURIComponent(path);
  } catch {
    // Keep malformed percent-encoding unchanged so the audit still reports it.
  }
  if (path.startsWith('/106/')) return resolve(root, path.slice('/106/'.length));
  if (path.startsWith('/public/')) return resolve(root, path.slice(1));
  if (path.startsWith('/assets/')) return resolve(root, 'public', path.slice(1));
  if (path.startsWith('/')) return resolve(root, path.slice(1));
  return resolve(dirname(sourcePath), path);
}

function digest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function isDeployableText(repositoryPath, absolutePath) {
  const deployable = repositoryPath === 'index.html'
    || repositoryPath.startsWith('public/')
    || repositoryPath.startsWith('supabase/functions/');
  return deployable && TEXT_EXTENSIONS.has(extname(absolutePath).toLowerCase());
}

export function auditPublicAssets(root = process.cwd()) {
  const absoluteRoot = resolve(root);
  const files = walkRepository(absoluteRoot);
  const repositoryPaths = new Map(files.map((path) => [path, normalizeRepositoryPath(absoluteRoot, path)]));
  const invalidRoots = [...repositoryPaths.values()]
    .filter((path) => path.startsWith('assets/') || path.startsWith('public/public/'))
    .sort();
  const textFiles = files.filter((path) => isDeployableText(repositoryPaths.get(path), path));
  const publicMedia = files.filter((path) => {
    const repositoryPath = repositoryPaths.get(path);
    return repositoryPath.startsWith('public/') && MEDIA_EXTENSIONS.has(extname(path).toLowerCase());
  });
  const referenced = new Set();
  const missing = [];

  for (const sourcePath of textFiles) {
    const sourceRepositoryPath = repositoryPaths.get(sourcePath);
    const content = readFileSync(sourcePath, 'utf8');
    for (const reference of extractAssetReferences(content)) {
      const resolved = resolveAssetReference(absoluteRoot, sourcePath, reference);
      if (!resolved) continue;
      if (!existsSync(resolved) || !statSync(resolved).isFile()) {
        missing.push({ source: sourceRepositoryPath, reference });
        continue;
      }
      referenced.add(resolved);
    }
  }

  const orphaned = publicMedia
    .filter((path) => !referenced.has(path))
    .map((path) => repositoryPaths.get(path))
    .sort();
  const duplicateGroups = new Map();
  for (const path of publicMedia) {
    const hash = digest(path);
    const paths = duplicateGroups.get(hash) ?? [];
    paths.push(repositoryPaths.get(path));
    duplicateGroups.set(hash, paths);
  }
  const duplicates = [...duplicateGroups.values()]
    .filter((paths) => paths.length > 1)
    .map((paths) => paths.sort())
    .sort((left, right) => left[0].localeCompare(right[0]));

  return {
    duplicates,
    invalidRoots,
    missing: missing.sort((left, right) => `${left.source}:${left.reference}`.localeCompare(`${right.source}:${right.reference}`)),
    orphaned,
    publicMedia: publicMedia.map((path) => repositoryPaths.get(path)).sort(),
  };
}

export function formatAssetAudit(report) {
  const lines = [];
  if (report.invalidRoots.length) {
    lines.push('Media must not be tracked outside the canonical public tree:');
    lines.push(...report.invalidRoots.map((path) => `  - ${path}`));
  }
  if (report.missing.length) {
    lines.push('Referenced media files are missing:');
    lines.push(...report.missing.map(({ source, reference }) => `  - ${source}: ${reference}`));
  }
  if (report.orphaned.length) {
    lines.push('Public media files are not referenced by deployable sources:');
    lines.push(...report.orphaned.map((path) => `  - ${path}`));
  }
  if (report.duplicates.length) {
    lines.push('Duplicate public media content was found:');
    for (const paths of report.duplicates) lines.push(`  - ${paths.join(', ')}`);
  }
  return lines.join('\n');
}
