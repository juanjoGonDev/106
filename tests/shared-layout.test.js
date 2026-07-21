import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pages = [
  'index.html',
  'ranking.html',
  'ligas.html',
  'cuenta.html',
  'legal.html',
  'privacidad.html',
  'cookies.html',
];

const layoutSource = readFileSync('public/layout.js', 'utf8');
const siteStyles = readFileSync('public/site.css', 'utf8');

describe('shared application shell', () => {
  it.each(pages)('%s delegates navigation and footer to layout.js', (page) => {
    const html = readFileSync(`public/${page}`, 'utf8');
    expect(html).toContain('src="./layout.js"');
    expect(html).toMatch(/<header class="site-header"><\/header>/);
    expect(html).toMatch(/<footer class="site-footer"><\/footer>/);
  });

  it('uses a flex page shell that pushes short-page footers to the bottom', () => {
    expect(siteStyles).toContain('body{display:flex;min-height:100vh;flex-direction:column}');
    expect(siteStyles).toContain('body>main{flex:1 0 auto}');
    expect(siteStyles).toContain('margin-top:auto');
  });

  it('provides close controls and backdrop dismissal for dialogs', () => {
    expect(layoutSource).toContain("closeButton.setAttribute('aria-label', 'Cerrar')");
    expect(layoutSource).toContain('if (event.target === dialog) closeDialog(dialog)');
    expect(layoutSource).toContain('celebration-close');
  });
});