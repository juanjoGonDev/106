import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const INCLUDED_EXTENSIONS = new Set(['.css', '.html', '.js', '.json', '.md', '.mjs', '.sql', '.svg', '.ts', '.yaml', '.yml']);
const IGNORED_DIRECTORIES = new Set(['.git', '.tmp', 'node_modules']);
const IGNORED_FILES = new Set(['pnpm-lock.yaml', 'tests/content-policy.test.js']);
const SITE_CARD_URL = 'https://imtitjwgiemlaabpioed.supabase.co/functions/v1/player-share/_site/card.png?v=20260723-2';

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
    expect(legalPages).toContain('Google Tag Manager administra etiquetas. Google Analytics solo se habilita tras consentimiento');
    expect(legalPages).toContain('Google Analytics es opcional');
    expect(legalPages).toContain('Última actualización: 22 de julio de 2026');
  });

  it('publishes crawler-first metadata backed by a live 1200x630 PNG endpoint', () => {
    const index = readFileSync('public/index.html', 'utf8');
    const rootIndex = readFileSync('index.html', 'utf8');
    const favicon = readFileSync('public/assets/favicon.svg', 'utf8');
    const playerTemplate = readFileSync('supabase/functions/player-share/player-card-template.svg', 'utf8');
    const siteTemplate = readFileSync('supabase/functions/player-share/site-card-template.svg', 'utf8');
    const edge = readFileSync('supabase/functions/player-share/index.ts', 'utf8');
    const manifest = JSON.parse(readFileSync('public/site.webmanifest', 'utf8'));

    expect(index).toContain('rel="icon" href="./assets/favicon.svg"');
    expect(index).toContain('rel="manifest" href="./site.webmanifest"');
    expect(index).toContain(SITE_CARD_URL);
    expect(rootIndex).toContain(SITE_CARD_URL);
    expect(index).toContain('name="twitter:card" content="summary_large_image"');
    expect(rootIndex).toContain('name="twitter:image:src"');
    expect(index).not.toContain('/public/assets/social-preview');
    expect(rootIndex).not.toContain('/public/assets/social-preview');
    expect(favicon).toContain('106');
    expect(playerTemplate).toContain('width="1200" height="630"');
    expect(siteTemplate).toContain('width="1200" height="630"');
    expect(playerTemplate).toContain('x="32" y="32" width="1136" height="566"');
    expect(siteTemplate).toContain('x="32" y="32" width="1136" height="566"');
    expect(edge).toContain("const SITE_ROUTE = '_site'");
    expect(edge).toContain('async function siteCardResponse');
    expect(edge).toContain("loadTemplate('site-card-template.svg'");
    expect(manifest.icons[0].src).toBe('./assets/favicon.svg');

    for (const obsolete of [
      'assets/social-preview.png',
      'public/assets/social-preview.png',
      'public/assets/social-preview.svg',
      'public/assets/player-card-template.svg',
      'public/public/assets/social-preview.png',
      'scripts/render-social-preview.mjs',
    ]) expect(existsSync(obsolete), obsolete).toBe(false);
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
