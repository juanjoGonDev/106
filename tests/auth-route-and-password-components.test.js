import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const read = (path) => readFileSync(path, 'utf8');
const authEntry = read('public/auth-route-entry.js');
const accountEntry = read('public/account-auth-entry.js');
const passwordComponent = read('public/password-visibility.js');
const passwordStyles = read('public/password-visibility.css');
const authStyles = read('public/v21.css');

const pages = {
  login: read('public/login.html'),
  register: read('public/registro.html'),
  verify: read('public/verificar-email.html'),
  reset: read('public/restablecer-clave.html'),
  account: read('public/cuenta.html'),
};

describe('authentication route guard wiring', () => {
  it('loads one centralized guard entry before auth page controllers', () => {
    for (const page of [pages.login, pages.register, pages.verify]) {
      expect(page).toContain('data-auth-shell');
      expect(page).toContain('src="./auth-route-entry.js"');
      expect(page).not.toContain('src="./auth-page-controller.js"');
    }
    expect(authEntry).toContain('guardAuthRoute({');
    expect(authEntry).toContain("import('./auth-page-controller.js')");
    expect(authStyles).toContain('body[data-auth-page]:not([data-auth-route-ready=true]) [data-auth-shell]{visibility:hidden}');
  });

  it('guards recovery and clears pending confirmation before account sign-out refresh', () => {
    expect(pages.reset).toContain('data-auth-page="reset"');
    expect(pages.reset).toContain('data-auth-shell');
    expect(read('public/password-reset.js')).toContain('guardAuthRoute({');
    expect(pages.account).toContain('src="./account-auth-entry.js"');
    expect(pages.account).not.toContain('src="./account-auth.js"');
    expect(accountEntry).toContain('clearPendingConfirmation(window.localStorage)');
    expect(accountEntry).toContain("await import('./account-auth.js')");
  });
});

describe('shared password visibility component wiring', () => {
  it('loads the same component and stylesheet on every password route', () => {
    for (const page of [pages.login, pages.register, pages.reset]) {
      expect(page).toContain('href="./password-visibility.css"');
      expect(page).toContain('src="./password-visibility.js"');
    }
    expect(pages.verify).not.toContain('password-visibility.js');
  });

  it('enhances password inputs idempotently with an accessible eye button', () => {
    expect(passwordComponent).toContain('input[type="password"]');
    expect(passwordComponent).toContain("input.dataset.passwordVisibilityReady === 'true'");
    expect(passwordComponent).toContain("button.setAttribute('aria-controls', input.id)");
    expect(passwordComponent).toContain("button.setAttribute('aria-pressed', state.pressed)");
    expect(passwordComponent).toContain("button.addEventListener('click'");
    expect(passwordComponent).toContain("createSvgElement(documentValue, 'svg'");
    expect(passwordStyles).toContain('.password-visibility-toggle:focus-visible');
    expect(passwordStyles).toContain('touch-action:manipulation');
  });
});
