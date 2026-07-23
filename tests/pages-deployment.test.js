import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/pages.yml', 'utf8');
const rootHtml = readFileSync('index.html', 'utf8');
const publicHtml = readFileSync('public/index.html', 'utf8');
const dynamicSiteCardPath = '/functions/v1/player-share/_site/card.png';

describe('GitHub Pages deployment', () => {
  it('does not execute the removed build-time social preview renderer', () => {
    expect(workflow).not.toContain('scripts/render-social-preview.mjs');
    expect(workflow).not.toContain('Render social preview PNG');
  });

  it('does not stage obsolete generated social preview assets', () => {
    for (const path of [
      'assets/social-preview.png',
      'assets/social-preview-v2.png',
      'public/assets/social-preview.png',
      'public/assets/social-preview-v2.png',
      'public/public/assets/social-preview.png',
      'public/public/assets/social-preview-v2.png',
    ]) expect(workflow).not.toContain(path);
  });

  it('keeps runtime config generation and validation in the deployment', () => {
    expect(workflow).toContain('node scripts/generate-config.mjs');
    expect(workflow).toContain('node scripts/validate-runtime-config.mjs');
    expect(workflow).toContain('public/config.js');
  });

  it('uses the dynamic Edge Function card from both deployable HTML entrypoints', () => {
    for (const html of [rootHtml, publicHtml]) {
      expect(html).toContain(`og:image\" content=\"https://imtitjwgiemlaabpioed.supabase.co${dynamicSiteCardPath}`);
      expect(html).toContain(`twitter:image\" content=\"https://imtitjwgiemlaabpioed.supabase.co${dynamicSiteCardPath}`);
    }
  });
});
