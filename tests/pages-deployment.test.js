import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/pages.yml', 'utf8');
const rootHtml = readFileSync('index.html', 'utf8');
const publicHtml = readFileSync('public/index.html', 'utf8');
const siteCardUrl = 'https://juanjogondev.github.io/106/assets/minuto-106-social-preview.jpg?v=20260723-3';

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

  it('uses the repository-owned social preview from both deployable HTML entrypoints', () => {
    for (const html of [rootHtml, publicHtml]) {
      expect(html).toContain(`og:image" content="${siteCardUrl}`);
      expect(html).toContain(`twitter:image" content="${siteCardUrl}`);
      expect(html).toContain('og:image:type" content="image/jpeg"');
      expect(html).toContain('og:image:width" content="1200"');
      expect(html).toContain('og:image:height" content="630"');
    }
  });
});
