import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const rasterSource = readFileSync('supabase/functions/_shared/human-check-raster.js', 'utf8');
const codeqlWorkflow = readFileSync('.github/workflows/codeql.yml', 'utf8');

describe('code scanning regressions', () => {
  it('keeps the shared security challenge on cryptographic randomness by default', () => {
    expect(rasterSource).toContain('crypto.getRandomValues(values)');
    expect(rasterSource).toContain('createHumanCheckLayout(random = secureUnitRandom)');
    expect(rasterSource).not.toContain('Math.random');
  });

  it('pins every active CodeQL workflow action to an immutable commit', () => {
    const actionReferences = codeqlWorkflow
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('uses:'))
      .map((line) => line.match(/^uses:\s+([^@\s]+)@([^\s#]+)/))
      .filter(Boolean);

    expect(actionReferences.length).toBeGreaterThan(0);
    for (const [, action, reference] of actionReferences) {
      expect(reference, `${action} must use a full commit SHA`).toMatch(/^[a-f0-9]{40}$/);
    }
    expect(codeqlWorkflow).toContain('persist-credentials: false');
  });
});
