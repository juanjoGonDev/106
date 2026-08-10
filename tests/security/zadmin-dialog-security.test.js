import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync('public/zadmin/index.html', 'utf8');
const client = readFileSync('public/zadmin/zadmin.js', 'utf8');

describe('zadmin destructive-action dialogs', () => {
  it('uses accessible app dialogs instead of native alert/confirm/prompt primitives', () => {
    expect(client).not.toMatch(/(?:window\.)?(?:alert|confirm|prompt)\s*\(/);
    expect(client).toContain('window.Minuto106UI = Object.freeze({ ask: askAdmin })');
    expect(html).toContain('<dialog id="adminConfirmDialog"');
    expect(html).toContain('<dialog id="adminRevokeDialog"');
  });

  it('supports keyboard cancellation and returns focus to the invoking control', () => {
    expect(client).toContain("$('#adminConfirmDialog').addEventListener('cancel'");
    expect(client).toContain("$('#adminRevokeDialog').addEventListener('cancel'");
    expect(client).toContain('focusIfAvailable(returnFocus)');
    expect(client).toContain("window.requestAnimationFrame(() => $('#adminConfirmCancel').focus())");
    expect(client).toContain("window.requestAnimationFrame(() => $('#adminRevokeReason').focus())");
  });

  it('keeps revocation reason validation recoverable inside the dialog', () => {
    expect(client).toContain("setStatus($('#adminRevokeStatus'), 'El motivo debe tener al menos 3 caracteres.', 'error')");
    expect(client).toContain("$('#adminRevokeReason').focus()");
    expect(html).toContain('id="adminRevokeReason"');
    expect(html).toContain('minlength="3" maxlength="500"');
  });
});
