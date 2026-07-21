import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicScripts = readdirSync('public')
  .filter((file) => file.endsWith('.js') && file !== 'config.js')
  .map((file) => ({ file, source: readFileSync(join('public', file), 'utf8') }));

const nativeDialogCall = /(^|[^\w$.])(?:alert|confirm|prompt)\s*\(/gm;

describe('application messaging', () => {
  it.each(publicScripts)('$file does not use native browser dialogs', ({ source }) => {
    expect(source).not.toMatch(nativeDialogCall);
  });

  it('provides shared styled information, error and confirmation flows', () => {
    const layout = readFileSync('public/layout.js', 'utf8');
    expect(layout).toContain('window.Minuto106UI');
    expect(layout).toContain('notify(input)');
    expect(layout).toContain('error(input)');
    expect(layout).toContain('ask(input)');
    expect(layout).toContain("dialog.showModal()");
  });
});