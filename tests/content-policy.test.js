import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const INCLUDED_EXTENSIONS = new Set(['.css', '.html', '.js', '.json', '.md', '.mjs', '.sql', '.svg', '.ts', '.yaml', '.yml']);
const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules']);
const IGNORED_FILES = new Set(['pnpm-lock.yaml', 'tests/content-policy.test.js']);
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function extension(path) {
  const index = path.lastIndexOf('.');
  return index < 0 ? '' : path.slice(index);
}

function sourceFiles(directory = ROOT) {
  const files = [];
  for (const name of readdirSync(directory)) {
    if (IGNORED_DIRECTORIES.has(name)) continue;
    const absolute = join(directory, name);
    const repositoryPath = relative(ROOT, absolute).replaceAll('\\', '/');
    const stats = statSync(absolute);
    if (stats.isDirectory()) files.push(...sourceFiles(absolute));
    else if (INCLUDED_EXTENSIONS.has(extension(name)) && !IGNORED_FILES.has(repositoryPath)) files.push(repositoryPath);
  }
  return files;
}

const legalPages = ['public/legal.html', 'public/privacidad.html', 'public/cookies.html']
  .map((path) => readFileSync(path, 'utf8'))
  .join('\n');

describe('public product language', () => {
  it('does not expose internal campaign terminology', () => {
    const forbidden = ['vi', 'ral'].join('');
    const findings = sourceFiles()
      .filter((path) => readFileSync(path, 'utf8').toLocaleLowerCase('es').includes(forbidden))
      .sort();
    expect(findings).toEqual([]);
  });

  it('describes the legal and privacy state in the present', () => {
    expect(legalPages).not.toMatch(/\ben el futuro\b|\bse activará\b|\bpodremos incorporar\b|\bprevisto\b/i);
    expect(legalPages).toContain('La configuración publicada no carga Google Analytics ni Google AdSense');
    expect(legalPages).toContain('Última actualización: 21 de julio de 2026');
  });

  it('publishes a favicon, manifest and rivalry social image', () => {
    const index = readFileSync('public/index.html', 'utf8');
    const rootIndex = readFileSync('index.html', 'utf8');
    const favicon = readFileSync('public/assets/favicon.svg', 'utf8');
    const previewVector = readFileSync('public/assets/social-preview.svg', 'utf8');
    const preview = readFileSync('public/assets/social-preview.png');
    const rootPreview = readFileSync('assets/social-preview.png');
    const manifest = JSON.parse(readFileSync('public/site.webmanifest', 'utf8'));

    expect(index).toContain('rel="icon" href="./assets/favicon.svg"');
    expect(index).toContain('rel="manifest" href="./site.webmanifest"');
    expect(index).toContain('https://juanjogondev.github.io/106/assets/social-preview.png');
    expect(rootIndex).toContain('https://juanjogondev.github.io/106/public/assets/social-preview.png');
    expect(favicon).toContain('106');
    expect(previewVector).toContain('ESPAÑA VS ARGENTINA');
    expect(preview.subarray(0, PNG_SIGNATURE.length)).toEqual(PNG_SIGNATURE);
    expect(rootPreview).toEqual(preview);
    expect(preview.readUInt32BE(16)).toBe(1200);
    expect(preview.readUInt32BE(20)).toBe(630);
    expect(manifest.icons[0].src).toBe('./assets/favicon.svg');
  });

  it('runs the production backend workflow only for backend-affecting paths', () => {
    const workflow = readFileSync('.github/workflows/supabase.yml', 'utf8');
    expect(workflow).not.toContain("- 'supabase/**'");
    for (const path of [
      "- 'supabase/migrations/**'",
      "- 'supabase/functions/**'",
      "- 'supabase/config.toml'",
      "- '.github/workflows/supabase.yml'",
    ]) expect(workflow).toContain(path);
  });
});
