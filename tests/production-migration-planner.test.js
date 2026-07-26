import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  buildMigrationPlan,
  formatGitHubOutputs,
  parseMigrationList,
  runMigrationPlanner,
} from '../scripts/plan-production-migrations.mjs';

const alignedStatus = `
        LOCAL          │        REMOTE         │     TIME (UTC)
  ─────────────────────┼───────────────────────┼──────────────────────
   20260724213300       │ 20260724213300        │ 2026-07-24 21:33:00
   20260724213400       │ 20260724213400        │ 2026-07-24 21:34:00
   20260726120000       │                       │ 2026-07-26 12:00:00
`;

const outOfOrderStatus = `
        LOCAL          │        REMOTE         │     TIME (UTC)
  ─────────────────────┼───────────────────────┼──────────────────────
   20260724213300       │ 20260724213300        │ 2026-07-24 21:33:00
   20260724213350       │                       │ 2026-07-24 21:33:50
   20260724213400       │ 20260724213400        │ 2026-07-24 21:34:00
   20260724213500       │ 20260724213500        │ 2026-07-24 21:35:00
   20260726120000       │                       │ 2026-07-26 12:00:00
`;

describe('production migration planner', () => {
  it('keeps standard push mode for migrations newer than remote history', () => {
    const plan = buildMigrationPlan(parseMigrationList(alignedStatus));

    expect(plan.includeAll).toBe(false);
    expect(plan.pendingVersions).toEqual(['20260726120000']);
    expect(plan.outOfOrderVersions).toEqual([]);
    expect(plan.maxRemoteVersion).toBe('20260724213400');
  });

  it('requires include-all when a compatibility migration predates the remote tip', () => {
    const plan = buildMigrationPlan(parseMigrationList(outOfOrderStatus));

    expect(plan.includeAll).toBe(true);
    expect(plan.pendingVersions).toEqual(['20260724213350', '20260726120000']);
    expect(plan.outOfOrderVersions).toEqual(['20260724213350']);
    expect(formatGitHubOutputs(plan)).toContain('include_all=true');
    expect(formatGitHubOutputs(plan)).toContain('out_of_order_versions=20260724213350');
  });

  it('parses ASCII tables and strips ANSI escape sequences', () => {
    const rows = parseMigrationList(
      '\u001B[32m20260724213300\u001B[0m | 20260724213300 | applied\n'
      + '20260724213350 |                | pending\n',
    );

    expect(rows).toEqual([
      { local: '20260724213300', remote: '20260724213300' },
      { local: '20260724213350', remote: null },
    ]);
  });

  it('fails closed when production contains a migration absent from the repository', () => {
    const rows = parseMigrationList(`
      LOCAL │ REMOTE
            │ 20260724213250
      20260724213300 │ 20260724213300
    `);

    expect(() => buildMigrationPlan(rows)).toThrow(
      /Remote migration history contains versions missing locally: 20260724213250/,
    );
  });

  it('writes deterministic GitHub outputs and diagnostics', () => {
    const write = vi.fn();
    const error = vi.fn();

    const plan = runMigrationPlanner({
      args: ['migration-status.txt'],
      readFile: () => outOfOrderStatus,
      stdout: { write },
      logger: { error },
    });

    expect(plan.includeAll).toBe(true);
    expect(write).toHaveBeenCalledOnce();
    expect(write.mock.calls[0][0]).toContain('pending_count=2');
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('`--include-all` is required'),
    );
  });

  it('keeps dry-run and apply modes aligned in the production workflow', () => {
    const workflow = readFileSync('.github/workflows/supabase.yml', 'utf8');

    expect(workflow).toContain('supabase migration list --linked');
    expect(workflow).toContain('id: migration_plan');
    expect(workflow).toContain('scripts/plan-production-migrations.mjs');
    expect(workflow).toContain('INCLUDE_ALL: ${{ steps.migration_plan.outputs.include_all }}');
    expect(workflow.match(/args\+=\(--include-all\)/g)).toHaveLength(2);
    expect(workflow).toContain('MIGRATION_DIFF_BASE="0000000000000000000000000000000000000000"');
  });
});
