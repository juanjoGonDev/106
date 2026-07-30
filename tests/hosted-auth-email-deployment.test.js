import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/supabase.yml', 'utf8');

function stepBlock(name) {
  const marker = `      - name: ${name}`;
  const start = workflow.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = workflow.indexOf('\n      - name:', start + marker.length);
  return workflow.slice(start, next === -1 ? workflow.length : next);
}

describe('hosted Supabase Auth email deployment', () => {
  it('runs only inside the existing protected production deployment boundary', () => {
    expect(workflow).toContain('permissions:\n  contents: read');
    expect(workflow).toContain('environment: production');
    expect(workflow).toContain('SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}');
    expect(workflow).toContain('PROJECT_ID: ${{ vars.SUPABASE_PROJECT_ID }}');
    expect(workflow).not.toContain('pull_request_target');
  });

  it('triggers when maintained email source or generated templates change', () => {
    for (const path of [
      "'supabase/templates/**'",
      "'supabase/config.toml'",
      "'scripts/auth-email-templates.mjs'",
      "'scripts/generate-auth-email-templates.mjs'",
      "'scripts/hosted-auth-email-sync.mjs'",
      "'scripts/sync-hosted-auth-email-templates.mjs'",
    ]) expect(workflow).toContain(`      - ${path}`);
  });

  it('applies and verifies the catalogue before backend mutation', () => {
    const synchronization = stepBlock('Synchronize and verify hosted Auth email templates');
    expect(synchronization).toContain('node scripts/sync-hosted-auth-email-templates.mjs --apply');
    expect(workflow.indexOf('Synchronize and verify hosted Auth email templates'))
      .toBeLessThan(workflow.indexOf('Apply additive database migrations'));
    expect(workflow.indexOf('Synchronize and verify hosted Auth email templates'))
      .toBeLessThan(workflow.indexOf('Deploy Edge Functions'));
  });
});
