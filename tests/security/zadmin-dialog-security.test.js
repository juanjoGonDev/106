import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync('public/zadmin/index.html', 'utf8');
const client = readFileSync('public/zadmin/zadmin.js', 'utf8');

describe('zadmin destructive-action components', () => {
  it('uses inline application components instead of browser alerts or modal primitives', () => {
    expect(client).not.toMatch(/(?:window\.)?(?:alert|confirm|prompt)\s*\(/);
    expect(client).not.toMatch(/\.showModal\s*\(|HTMLDialogElement/);
    expect(html).not.toContain('<dialog');
    expect(html).toContain('id="adminBanConfirmComponent"');
    expect(html).toContain('id="adminRevokeComponent"');
  });

  it('supports keyboard cancellation and returns focus to the invoking control', () => {
    expect(client).toContain("document.addEventListener('keydown', cancelActionComponent)");
    expect(client).toContain("if (event.key !== 'Escape') return");
    expect(client).toContain('if (confirmResolver)');
    expect(client).toContain('if (revokeResolver)');
    expect(client).toContain('focusIfAvailable(returnFocus)');
    expect(client).toContain("window.requestAnimationFrame(() => $('#adminBanConfirmCancel').focus())");
    expect(client).toContain("window.requestAnimationFrame(() => $('#adminRevokeReason').focus())");
  });

  it('keeps revocation reason validation recoverable inside the inline component', () => {
    expect(client).toContain("setStatus($('#adminRevokeStatus'), 'El motivo debe tener al menos 3 caracteres.', 'error')");
    expect(client).toContain("$('#adminRevokeReason').focus()");
    expect(html).toContain('id="adminRevokeReason"');
    expect(html).toContain('minlength="3" maxlength="500"');
  });
});
