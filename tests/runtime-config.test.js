import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function readRepositoryFile(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

describe('runtime configuration', () => {
  it('uses safe public placeholders without shipping a project secret', async () => {
    const config = await readRepositoryFile('public/config.js');
    expect(config).toContain('YOUR_PROJECT_REF');
    expect(config).not.toContain('service_role');
    expect(config).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}/);
  });

  it('generates the public API URL from a non-secret project id', async () => {
    const script = await readRepositoryFile('scripts/generate-config.mjs');
    expect(script).toContain('SUPABASE_PROJECT_ID');
    expect(script).toContain('/functions/v1/game-api');
    expect(script).not.toContain('SUPABASE_ANON_KEY');
  });

  it('validates the generated public runtime contract', async () => {
    const validator = await readRepositoryFile('scripts/validate-runtime-config.mjs');
    expect(validator).toContain('expectedProjectId');
    expect(validator).toContain('expectedOrigin');
    expect(validator).toContain('expectedTurnstileSiteKey');
    expect(validator).toContain('expectedAnalyticsId');
    expect(validator).toContain('expectedGoogleTagManagerId');
    expect(validator).toContain('expectedAdsClient');
  });

  it('keeps production-only values in workflow variables and secrets', async () => {
    const [pages, supabase] = await Promise.all([
      readRepositoryFile('.github/workflows/pages.yml'),
      readRepositoryFile('.github/workflows/supabase.yml'),
    ]);
    expect(pages).toContain('vars.SUPABASE_PROJECT_ID');
    expect(pages).toContain('vars.PUBLIC_SITE_URL');
    expect(supabase).toContain('secrets.SUPABASE_ACCESS_TOKEN');
    expect(supabase).toContain('secrets.SUPABASE_SECRET_KEYS');
    expect(supabase).toContain('secrets.HASH_PEPPER');
  });

  it('supports both legacy and workflow-based GitHub Pages publishing', async () => {
    const workflow = await readRepositoryFile('.github/workflows/pages.yml');

    expect(workflow).toContain('echo "build_type=$build_type"');
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
    expect(styles).toMatch(/@media\s*\(max-width:\s*700px\)/);
  });
});
