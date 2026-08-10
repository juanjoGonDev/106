import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync('public/zadmin/index.html', 'utf8');
const localDev = readFileSync('scripts/local-dev.mjs', 'utf8');

describe('zadmin entry and local-development contract', () => {
  it('loads route-owned assets from canonical absolute paths for both /zadmin and /zadmin/', () => {
    expect(html).toContain('href="/zadmin/zadmin.css"');
    expect(html).toContain('href="/zadmin/zadmin-state.css"');
    expect(html).toContain('src="/zadmin/zadmin.js"');
    expect(html).toContain('src="/config.js"');
    expect(html).toContain('src="/password-visibility.js"');
    expect(html).not.toMatch(/(?:href|src)="\.\/zadmin(?:-state)?\.(?:css|js)"/);
  });

  it('cannot leak admin credentials into the URL if the application module fails to load', () => {
    expect(html).toMatch(/<form id="adminLoginForm" action="\/zadmin\/" method="post" novalidate>/);
    expect(html).not.toMatch(/name="(?:username|password)"/i);
    expect(html).toContain('autocomplete="username"');
    expect(html).toContain('autocomplete="current-password"');
  });

  it('keeps local zadmin credentials ephemeral and outside committed public assets', () => {
    expect(localDev).toContain("const localAdminUser = 'local-admin'");
    expect(localDev).toContain("randomBytes(18).toString('base64url')");
    expect(localDev).toContain("['ZU_ADMIN_USER', localAdminUser]");
    expect(localDev).toContain("['ZU_ADMIN_PSW', localAdminPassword]");
    expect(localDev).toContain('localZadminHealthUrl()');
    expect(localDev).toContain('Local-only credentials:');
    expect(html).not.toMatch(/ZU_ADMIN_(?:USER|PSW)/);
  });

  it('renders the login as a centered application card rather than full-width fields', () => {
    expect(html).toContain('class="zadmin-login-stage"');
    expect(html).toContain('class="zadmin-card zadmin-login-card"');
    expect(html).toContain('class="zadmin-login-heading"');
    expect(html).toContain('class="zadmin-login-content"');
  });
});
