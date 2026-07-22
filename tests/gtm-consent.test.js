import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pages = [
  'public/index.html',
  'public/ranking.html',
  'public/ligas.html',
  'public/cuenta.html',
  'public/cookies.html',
  'public/privacidad.html',
  'public/legal.html',
];
const bootstrap = readFileSync('public/privacy-bootstrap.js', 'utf8');
const compliance = readFileSync('public/compliance.js', 'utf8');
const layout = readFileSync('public/layout.js', 'utf8');

function read(path) {
  return readFileSync(path, 'utf8');
}

describe('Google Tag Manager and consent components', () => {
  it.each(pages)('uses the shared head bootstrap and immediate noscript fallback in %s', (path) => {
    const html = read(path);
    const head = html.indexOf('<head>');
    const bootstrapScript = html.indexOf('<script src="./privacy-bootstrap.js"></script>');
    const meta = html.indexOf('<meta charset');
    const body = html.indexOf('<body>');
    const noscript = html.indexOf('googletagmanager.com/ns.html?id=GTM-NKZK4DC5');
    const header = html.indexOf('<header');

    expect(bootstrapScript).toBeGreaterThan(head);
    expect(bootstrapScript).toBeLessThan(meta);
    expect((html.match(/privacy-bootstrap\.js/g) || [])).toHaveLength(1);
    expect(html).not.toContain('(function(w,d,s,l,i)');
    expect(html).not.toContain("gtag('consent', 'default'");
    expect(noscript).toBeGreaterThan(body);
    expect(noscript).toBeLessThan(header);
  });

  it('sets Consent Mode v2 before loading the shared GTM container', () => {
    const defaultConsent = bootstrap.indexOf("gtag('consent', 'default'");
    const loadContainer = bootstrap.lastIndexOf('loadTagManager();');
    expect(defaultConsent).toBeGreaterThan(-1);
    expect(defaultConsent).toBeLessThan(loadContainer);
    expect(bootstrap).toContain("const TAG_MANAGER_ID = 'GTM-NKZK4DC5'");
    expect(bootstrap).toContain('analytics_storage:');
    expect(bootstrap).toContain('ad_user_data:');
    expect(bootstrap).toContain('ad_personalization:');
    expect(bootstrap).toContain("gtag('set', 'ads_data_redaction', true)");
  });

  it('renders privacy UI and compliance behavior once through the shared layout', () => {
    for (const path of pages) {
      const html = read(path);
      expect(html).not.toContain('id="cookieBanner"');
      expect(html).not.toContain('id="cookieDialog"');
      expect(html).not.toContain('<script src="./compliance.js"></script>');
      expect(html.indexOf('./config.js')).toBeLessThan(html.indexOf('./layout.js'));
    }
    expect(layout).toContain('function createPrivacyBanner()');
    expect(layout).toContain('function createPrivacyDialog()');
    expect(layout).toContain('renderPrivacyComponents();');
    expect(layout).toContain("ensureClassicScript('./compliance.js'");
    expect(layout).toContain("ensureStylesheet('./v9.css'");
  });

  it('updates consent, supports withdrawal, and does not load a second direct Analytics tag', () => {
    expect(compliance).toContain("gtag('consent', 'update'");
    expect(compliance).toContain("event: 'minuto106_consent_update'");
    expect(compliance).toContain("chip.addEventListener('click', openSettings)");
    expect(compliance).toContain('clearAnalyticsCookies');
    expect(compliance).not.toContain('googletagmanager.com/gtag/js');
    expect(compliance).not.toContain("gtag('config'");
  });

  it('keeps accept and reject at equal visual prominence in the reusable component', () => {
    expect(layout).toContain('id="rejectCookies" class="secondary"');
    expect(layout).toContain('id="acceptCookies" class="secondary"');
    expect(bootstrap).toContain('CONSENT_MAX_AGE_MS = 730');
  });

  it('documents analytics, cookies, consent withdrawal and international transfers', () => {
    const cookies = read('public/cookies.html');
    const privacy = read('public/privacidad.html');
    const legal = read('public/legal.html');
    expect(cookies).toContain('Google Tag Manager');
    expect(cookies).toContain('<code>_ga</code>');
    expect(cookies).toContain('Máximo 24 meses');
    expect(privacy).toContain('consentimiento');
    expect(privacy).toContain('Transferencias internacionales');
    expect(legal).toContain('rechazarla no limita el juego');
  });
});
