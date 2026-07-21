import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  PLACEHOLDER_API_URL,
  buildRuntimeConfig,
  validateRuntimeConfig,
} from '../scripts/runtime-config.mjs';

const readRepositoryFile = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

describe('runtime configuration', () => {
  it('prefers an explicit Edge Function URL', () => {
    const config = buildRuntimeConfig({
      SUPABASE_FUNCTIONS_URL: 'https://example.supabase.co/functions/v1/game-api/',
      SUPABASE_PROJECT_ID: 'ignored-project',
      PUBLIC_SITE_URL: 'https://example.com/',
    });

    expect(config.apiBaseUrl).toBe('https://example.supabase.co/functions/v1/game-api');
    expect(config.publicSiteUrl).toBe('https://example.com');
    expect(validateRuntimeConfig(config)).toEqual([]);
  });

  it('derives the Edge Function and Pages URLs from public CI metadata', () => {
    const config = buildRuntimeConfig({
      SUPABASE_PROJECT_ID: 'abcdefghijklmnopqrst',
      GITHUB_PAGES_URL: 'https://juanjogondev.github.io/106/',
    });

    expect(config.apiBaseUrl).toBe(
      'https://abcdefghijklmnopqrst.supabase.co/functions/v1/game-api',
    );
    expect(config.publicSiteUrl).toBe('https://juanjogondev.github.io/106');
    expect(validateRuntimeConfig(config)).toEqual([]);
  });

  it('derives a repository Pages URL when the API does not return one', () => {
    const config = buildRuntimeConfig({
      SUPABASE_PROJECT_ID: 'abcdefghijklmnopqrst',
      GITHUB_REPOSITORY: 'juanjoGonDev/106',
      GITHUB_REPOSITORY_OWNER: 'juanjoGonDev',
    });

    expect(config.publicSiteUrl).toBe('https://juanjogondev.github.io/106');
  });

  it('rejects a missing or malformed project reference', () => {
    const config = buildRuntimeConfig({
      SUPABASE_PROJECT_ID: 'not valid!',
      GITHUB_PAGES_URL: 'https://juanjogondev.github.io/106',
    });

    expect(config.apiBaseUrl).toBe(PLACEHOLDER_API_URL);
    expect(validateRuntimeConfig(config)).toContain(
      'Set SUPABASE_FUNCTIONS_URL or SUPABASE_PROJECT_ID.',
    );
  });
});

describe('Pages and mobile navigation regressions', () => {
  it('provides a branch-publishing root entry point that preserves URL state', async () => {
    const source = await readRepositoryFile('index.html');

    expect(source).toContain("new URL('./public/', window.location.href)");
    expect(source).toContain('target.search = window.location.search');
    expect(source).toContain('target.hash = window.location.hash');
  });

  it('supports both legacy and workflow-based GitHub Pages publishing', async () => {
    const workflow = await readRepositoryFile('.github/workflows/pages.yml');

    expect(workflow).toContain("build_type=\"$build_type\"");
    expect(workflow).toContain("steps.pages-mode.outputs.build_type == 'legacy'");
    expect(workflow).toContain("steps.pages-mode.outputs.build_type == 'workflow'");
    expect(workflow).toContain('SUPABASE_PROJECT_ID: ${{ vars.SUPABASE_PROJECT_ID }}');
    expect(workflow).toContain('pages/builds');
  });

  it('uses an accessible hamburger menu on small screens', async () => {
    const [layout, styles] = await Promise.all([
      readRepositoryFile('public/layout.js'),
      readRepositoryFile('public/site.css'),
    ]);

    expect(layout).toContain("menuButton.className = 'site-menu-toggle'");
    expect(layout).toContain("menuButton.setAttribute('aria-expanded', 'false')");
    expect(layout).toContain("event.key !== 'Escape'");
    expect(styles).toContain('.site-header[data-menu-open="true"] .site-navigation');
    expect(styles).toContain('@media(max-width:700px)');
  });
});
