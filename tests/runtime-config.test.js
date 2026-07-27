import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_API_URL,
  DEFAULT_SUPABASE_PROJECT_ID,
  DEFAULT_SUPABASE_URL,
  buildRuntimeConfig,
  validateRuntimeConfig,
} from '../scripts/runtime-config.mjs';

const readRepositoryFile = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const publishableKey = `sb_publishable_${'a'.repeat(32)}`;

describe('runtime configuration', () => {
  it('prefers an explicit Edge Function URL and derives the auth boundary', () => {
    const config = buildRuntimeConfig({
      SUPABASE_FUNCTIONS_URL: 'https://example.supabase.co/functions/v1/game-api/',
      SUPABASE_PROJECT_ID: 'ignored-project',
      SUPABASE_PUBLISHABLE_KEY: publishableKey,
      PUBLIC_SITE_URL: 'https://example.com/',
    });

    expect(config.apiBaseUrl).toBe('https://example.supabase.co/functions/v1/game-api');
    expect(config.accountAuthApiUrl).toBe('https://example.supabase.co/functions/v1/account-auth');
    expect(config.supabaseUrl).toBe('https://example.supabase.co');
    expect(config.supabasePublishableKey).toBe(publishableKey);
    expect(config.publicSiteUrl).toBe('https://example.com');
    expect(validateRuntimeConfig(config, { requireAuth: true })).toEqual([]);
  });

  it('accepts the local Supabase URL and anon JWT for the development server only', () => {
    const anonKey = `eyJ${'x'.repeat(48)}`;
    const config = buildRuntimeConfig({
      SUPABASE_URL: 'http://127.0.0.1:54321/',
      SUPABASE_PUBLISHABLE_KEY: anonKey,
      PUBLIC_SITE_URL: 'http://localhost:3000/',
    });

    expect(config.apiBaseUrl).toBe('http://127.0.0.1:54321/functions/v1/game-api');
    expect(config.accountAuthApiUrl).toBe('http://127.0.0.1:54321/functions/v1/account-auth');
    expect(config.supabaseUrl).toBe('http://127.0.0.1:54321');
    expect(config.supabasePublishableKey).toBe(anonKey);
    expect(config.publicSiteUrl).toBe('http://localhost:3000');
    expect(validateRuntimeConfig(config)).toContain('The generated Supabase project URL is invalid.');
    expect(validateRuntimeConfig(config, { allowLocal: true, requireAuth: true })).toEqual([]);
  });

  it('derives the Edge Function, Supabase and Pages URLs from public CI metadata', () => {
    const config = buildRuntimeConfig({
      SUPABASE_PROJECT_ID: 'abcdefghijklmnopqrst',
      SUPABASE_PUBLISHABLE_KEY: publishableKey,
      GITHUB_PAGES_URL: 'https://juanjogondev.github.io/106/',
    });

    expect(config.apiBaseUrl).toBe(
      'https://abcdefghijklmnopqrst.supabase.co/functions/v1/game-api',
    );
    expect(config.accountAuthApiUrl).toBe(
      'https://abcdefghijklmnopqrst.supabase.co/functions/v1/account-auth',
    );
    expect(config.supabaseUrl).toBe('https://abcdefghijklmnopqrst.supabase.co');
    expect(config.publicSiteUrl).toBe('https://juanjogondev.github.io/106');
    expect(validateRuntimeConfig(config, { requireAuth: true })).toEqual([]);
  });

  it('derives a repository Pages URL when the API does not return one', () => {
    const config = buildRuntimeConfig({
      SUPABASE_PROJECT_ID: 'abcdefghijklmnopqrst',
      GITHUB_REPOSITORY: 'juanjoGonDev/106',
      GITHUB_REPOSITORY_OWNER: 'juanjoGonDev',
    });

    expect(config.publicSiteUrl).toBe('https://juanjogondev.github.io/106');
  });

  it('uses the public production project when CI variables are missing or malformed', () => {
    const missing = buildRuntimeConfig({});
    const malformed = buildRuntimeConfig({
      SUPABASE_PROJECT_ID: 'not valid!',
      SUPABASE_PUBLISHABLE_KEY: 'secret-looking-but-invalid',
      GITHUB_PAGES_URL: 'https://juanjogondev.github.io/106',
    });

    expect(DEFAULT_SUPABASE_PROJECT_ID).toBe('imtitjwgiemlaabpioed');
    expect(DEFAULT_SUPABASE_URL).toBe('https://imtitjwgiemlaabpioed.supabase.co');
    expect(missing.apiBaseUrl).toBe(DEFAULT_API_URL);
    expect(malformed.apiBaseUrl).toBe(DEFAULT_API_URL);
    expect(missing.supabasePublishableKey).toBe('');
    expect(malformed.supabasePublishableKey).toBe('');
    expect(missing.publicSiteUrl).toBe('https://juanjogondev.github.io/106');
    expect(validateRuntimeConfig(missing)).toEqual([]);
    expect(validateRuntimeConfig(malformed)).toEqual([]);
    expect(validateRuntimeConfig(missing, { requireAuth: true })).toContain(
      'SUPABASE_PUBLISHABLE_KEY is required for the production authentication UI.',
    );
  });

  it('rejects malformed public endpoints while keeping the safe auth fallback', () => {
    const config = buildRuntimeConfig({
      SUPABASE_FUNCTIONS_URL: 'https://api.example.com/not-game-api',
      SUPABASE_URL: 'not-a-url',
      PUBLIC_SITE_URL: 'invalid',
    });

    expect(config.accountAuthApiUrl).toBe(`${DEFAULT_SUPABASE_URL}/functions/v1/account-auth`);
    expect(validateRuntimeConfig(config)).toEqual(expect.arrayContaining([
      'The generated Supabase Edge Function URL is invalid.',
      'The public GitHub Pages URL could not be derived.',
    ]));
  });

  it('keeps a usable committed public configuration for branch-based Pages', async () => {
    const source = await readRepositoryFile('public/config.js');

    expect(source).toContain(DEFAULT_API_URL);
    expect(source).toContain('/functions/v1/account-auth');
    expect(source).toContain('supabasePublishableKey');
    expect(source).not.toContain('YOUR_PROJECT_REF');
  });

  it('makes the development server inject local Supabase status into config.js', async () => {
    const source = await readRepositoryFile('scripts/serve.mjs');

    expect(source).toContain("spawnSync('supabase', ['status', '-o', 'env']");
    expect(source).toContain("if (pathname === '/config.js')");
    expect(source).toContain('SUPABASE_PUBLISHABLE_KEY: publishableKey');
    expect(source).toContain('window.__MINUTO106_CONFIG__=');
    expect(source).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
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

    expect(workflow).toContain('echo "build_type=$build_type"');
    expect(workflow).toContain("steps.pages-mode.outputs.build_type == 'legacy'");
    expect(workflow).toContain("steps.pages-mode.outputs.build_type == 'workflow'");
    expect(workflow).toContain('SUPABASE_PROJECT_ID: ${{ vars.SUPABASE_PROJECT_ID }}');
    expect(workflow).toContain('SUPABASE_PUBLISHABLE_KEY: ${{ vars.SUPABASE_PUBLISHABLE_KEY }}');
    expect(workflow).toContain("REQUIRE_AUTH_CONFIG: 'true'");
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
    expect(styles).toMatch(/@media\s*\(max-width:\s*700px\)/);
  });
});
