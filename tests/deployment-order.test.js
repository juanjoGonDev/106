import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pagesWorkflow = readFileSync('.github/workflows/pages.yml', 'utf8');
const supabaseWorkflow = readFileSync('.github/workflows/supabase.yml', 'utf8');
const readinessApi = readFileSync('supabase/functions/game-ready-api/index.ts', 'utf8');

describe('frontend and readiness backend deployment ordering', () => {
  it('publishes a versioned readiness compatibility contract', () => {
    expect(readinessApi).toContain("const READINESS_CONTRACT = 'prepared-countdown-v1'");
    expect(readinessApi).toContain("if (action === 'health')");
    expect(readinessApi).toContain('contract: READINESS_CONTRACT');
  });

  it('blocks Pages until the compatible backend contract responds', () => {
    expect(pagesWorkflow).toContain('Wait for compatible readiness backend');
    expect(pagesWorkflow).toContain("--data '{\"action\":\"health\"}'");
    expect(pagesWorkflow).toContain('.contract == "prepared-countdown-v1"');
    expect(pagesWorkflow).toContain('Waiting for compatible readiness backend');
    expect(pagesWorkflow.indexOf('Wait for compatible readiness backend'))
      .toBeLessThan(pagesWorkflow.indexOf('Generate public runtime config'));
  });

  it('applies migrations before deploying every configured Edge Function', () => {
    const migrationStep = supabaseWorkflow.indexOf('Apply additive database migrations');
    const functionStep = supabaseWorkflow.indexOf('Deploy Edge Functions');
    expect(migrationStep).toBeGreaterThan(-1);
    expect(functionStep).toBeGreaterThan(migrationStep);
    expect(supabaseWorkflow).toContain('supabase functions deploy --project-ref "$PROJECT_ID"');
  });
});
