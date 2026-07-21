import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { buildAllowedOrigins } from '../scripts/build-allowed-origins.mjs';

const origins = (environment) => buildAllowedOrigins(environment).split(',');


describe('production CORS origins', () => {
  it('normalizes a GitHub Pages URL with a repository path to its browser origin', () => {
    expect(origins({
      GITHUB_REPOSITORY_OWNER: 'juanjoGonDev',
      PUBLIC_SITE_URL: 'https://juanjogondev.github.io/106/',
      ALLOWED_ORIGINS: 'https://example.com/path/,http://localhost:3000/',
    })).toEqual([
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'https://juanjogondev.github.io',
      'https://example.com',
    ]);
  });

  it('deduplicates equivalent URLs and rejects unsafe schemes', () => {
    expect(origins({
      GITHUB_REPOSITORY_OWNER: 'juanjoGonDev',
      PUBLIC_SITE_URL: 'https://juanjogondev.github.io/106',
      ALLOWED_ORIGINS: 'https://juanjogondev.github.io,https://juanjogondev.github.io/106/',
    })).toHaveLength(3);

    expect(() => buildAllowedOrigins({ ALLOWED_ORIGINS: 'javascript:alert(1)' })).toThrow(
      'Allowed origins must use HTTP or HTTPS',
    );
  });

  it('ignores a legacy wildcard instead of deploying permissive CORS', () => {
    expect(origins({
      GITHUB_REPOSITORY_OWNER: 'juanjoGonDev',
      ALLOWED_ORIGINS: '*,https://example.com/path',
    })).toEqual([
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'https://juanjogondev.github.io',
      'https://example.com',
    ]);
  });

  it('repairs CORS before migrations and treats snapshots as an optional safety layer', async () => {
    const workflow = await readFile(
      new URL('../.github/workflows/supabase.yml', import.meta.url),
      'utf8',
    );

    expect(workflow).toContain('canonical_origins="$(node scripts/build-allowed-origins.mjs)"');
    expect(workflow).toContain('"ALLOWED_ORIGINS=$canonical_origins"');
    expect(workflow).toContain('GITHUB_REPOSITORY_OWNER: ${{ github.repository_owner }}');
    expect(workflow).toContain("if: ${{ env.SUPABASE_DB_URL != '' }}");
    expect(workflow).not.toContain("test -n \"$SUPABASE_DB_URL\"");
    expect(workflow.indexOf('Repair production CORS allowlist')).toBeLessThan(
      workflow.indexOf('Apply additive database migrations'),
    );
  });
});
