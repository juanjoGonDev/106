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
const compliance = readFileSync('public/compliance.js', 'utf8');

function read(path) {
  return readFileSync(path, 'utf8');
}

describe('Google Tag Manager and consent', () => {
  it.each(pages)('installs GTM at the top and noscript immediately after body in %s', (path) => {
    const html = read(path);
    const head = html.indexOf('<head>');
    const consentDefault = html.search(/gtag\('consent',\s*'default'/);
    const container = html.indexOf('GTM-NKZK4DC5');
    const meta = html.indexOf('<meta charset');
    const body = html.indexOf('<body>');
    const noscript = html.indexOf('googletagmanager.com/ns.html?id=GTM-NKZK4DC5');
    const header = html.indexOf('<header');

    expect(consentDefault).toBeGreaterThan(head);
    expect(consentDefault).toBeLessThan(container);
    expect(container).toBeLessThan(meta);
    expect(noscript).toBeGreaterThan(body);
    expect(noscript).toBeLessThan(header);
    expect(html).toContain('./compliance.js');
  });

  it('defaults Consent Mode v2 to denied and updates all Google consent types', () => {
    const index = read('public/index.html');
    expect(index).toContain('analytics_storage: granted(consent.analytics)');
    expect(index).toContain('ad_user_data: granted(consent.ads)');
    expect(index).toContain('ad_personalization: granted(consent.ads)');
    expect(index).toContain("window.gtag('set', 'ads_data_redaction', true)");
    expect(compliance).toContain("gtag('consent', 'update'");
    expect(compliance).toContain("event: 'minuto106_consent_update'");
  });

  it('does not load a second direct Google Analytics tag', () => {
    expect(compliance).not.toContain('googletagmanager.com/gtag/js');
    expect(compliance).not.toContain("gtag('config'");
  });

  it('gives accept and reject equal visual weight and supports later withdrawal', () => {
    const index = read('public/index.html');
    expect(index).toContain('id="rejectCookies" class="secondary"');
    expect(index).toContain('id="acceptCookies" class="secondary"');
    expect(compliance).toContain("chip.addEventListener('click', openSettings)");
    expect(compliance).toContain('clearAnalyticsCookies');
    expect(compliance).toContain('CONSENT_MAX_AGE_MS = 730');
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
