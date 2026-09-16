import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync('public/zadmin/index.html', 'utf8');
const localDev = readFileSync('scripts/local-dev.mjs', 'utf8');
const localServer = readFileSync('scripts/serve.mjs', 'utf8');

describe('zadmin entry and local-development contract', () => {
  it('keeps route assets inside the deployment base and canonicalizes slashless local entry', () => {
    expect(html).toContain('href="../styles.css"');
    expect(html).toContain('href="./zadmin.css"');
    expect(html).toContain('href="./zadmin-state.css"');
    expect(html).toContain('src="../config.js"');
    expect(html).toContain('src="../password-visibility.js"');
    expect(html).toContain('src="./zadmin.js"');
    expect(html).not.toMatch(/(?:href|src)="\/(?:styles\.css|config\.js|password-visibility\.js|zadmin\/)/);

    const projectRoute = new URL('https://example.test/106/zadmin/');
    expect(new URL('../styles.css', projectRoute).pathname).toBe('/106/styles.css');
    expect(new URL('./zadmin.css', projectRoute).pathname).toBe('/106/zadmin/zadmin.css');
    expect(new URL('./zadmin-state.css', projectRoute).pathname).toBe('/106/zadmin/zadmin-state.css');
    expect(new URL('../config.js', projectRoute).pathname).toBe('/106/config.js');
    expect(new URL('../password-visibility.js', projectRoute).pathname).toBe('/106/password-visibility.js');
    expect(new URL('./zadmin.js', projectRoute).pathname).toBe('/106/zadmin/zadmin.js');

    expect(localServer).toContain("pathname === '/zadmin'");
    expect(localServer).toContain("redirect(response, '/zadmin/')");
    expect(localServer).toContain("request.method === 'GET' || request.method === 'HEAD'");
  });

  it('cannot leak admin credentials into the URL if the application module fails to load', () => {
    expect(html).toMatch(/<form id="adminLoginForm" action="\.\/" method="post" novalidate>/);
    expect(html).not.toMatch(/name="(?:username|password)"/i);
    expect(new URL('./', 'https://example.test/106/zadmin/').pathname).toBe('/106/zadmin/');
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
