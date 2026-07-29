import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const unsupportedProvider = ['face', 'book'].join('');
const unsupportedPattern = new RegExp(unsupportedProvider, 'iu');

function filesBelow(path) {
  if (!existsSync(path)) return [];
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path)
    .flatMap((entry) => filesBelow(join(path, entry)));
}

function textFiles(paths) {
  return paths
    .flatMap(filesBelow)
    .filter((path) => /\.(?:html|js|ts|md)$/u.test(path));
}

const maintainedTextFiles = textFiles([
  'public',
  'docs',
  'README.md',
  'SECURITY.md',
  'supabase/functions',
]);

function read(path) {
  return readFileSync(path, 'utf8');
}

describe('Google-only social authentication contract', () => {
  it('removes the unsupported provider from every maintained public and operational text', () => {
    const violations = maintainedTextFiles
      .filter((path) => unsupportedPattern.test(read(path)));

    expect(violations).toEqual([]);
  });

  it('exposes exactly one Google OAuth control on login, registration and local account linking', () => {
    for (const path of ['public/login.html', 'public/registro.html', 'public/cuenta.html']) {
      const html = read(path);
      expect(html.match(/class="oauth-button"/gu)).toHaveLength(path.endsWith('cuenta.html') ? 2 : 1);
      expect(html).toContain('googleSignIn');
      expect(html).not.toMatch(unsupportedPattern);
    }

    expect(read('public/cuenta.html')).toContain('authenticatedGoogle');
  });

  it('rejects unsupported providers at browser and Edge boundaries', () => {
    const browserState = read('public/auth-account-state.js');
    const pageController = read('public/auth-page-controller.js');
    const accountController = read('public/account-auth.js');
    const edgeCore = read('supabase/functions/account-auth/core.js');

    expect(browserState).toContain("const PROVIDERS = new Set(['google'])");
    expect(pageController).toContain("client.signInWithOAuth('google'");
    expect(accountController).toContain("client.signInWithOAuth('google'");
    expect(edgeCore).toContain("const SUPPORTED_PROVIDERS = new Set(['email', 'google'])");
    for (const source of [browserState, pageController, accountController, edgeCore]) {
      expect(source).not.toMatch(unsupportedPattern);
    }
  });

  it('uses an additive forward migration for future email and Google writes', () => {
    const migration = read('supabase/migrations/20260729142000_google_only_auth_providers.sql');

    expect(migration.match(/not valid;/giu)).toHaveLength(2);
    expect(migration).toContain("check (provider in ('email', 'google'))");
    expect(migration).toContain("check (origin_provider is null or origin_provider in ('email', 'google'))");
    expect(migration).not.toMatch(/drop\s+(?:constraint|column|table|function|type)/iu);
    expect(migration).not.toMatch(unsupportedPattern);
  });
});
