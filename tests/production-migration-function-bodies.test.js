import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  migrationExecutionSql,
  migrationViolations,
} from '../scripts/check-production-migrations.mjs';

const temporaryDirectories = [];

function migration(content) {
  const directory = mkdtempSync(join(tmpdir(), 'minuto106-migration-'));
  temporaryDirectories.push(directory);
  const path = join(directory, '20260727120000_example.sql');
  writeFileSync(path, content, 'utf8');
  return path;
}

afterEach(() => {
  while (temporaryDirectories.length) rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
});

describe('production migration runtime function filtering', () => {
  it('omits runtime PL/pgSQL and SQL function bodies from deployment-time checks', () => {
    const sql = `
      create or replace function public.remove_invalid_reward()
      returns integer language plpgsql as $$
      begin
        delete from public.game_player_achievements where false;
        return 0;
      end;
      $$;
      create function public.remove_invalid_trophy()
      returns integer language sql as $body$
        delete from public.game_league_trophies where false returning 1;
      $body$;
    `;

    const executable = migrationExecutionSql(sql);
    expect(executable).not.toContain('game_player_achievements');
    expect(executable).not.toContain('game_league_trophies');
    expect(migrationViolations([migration(sql)])).toEqual([]);
  });

  it('still detects destructive top-level statements and destructive DO blocks', () => {
    expect(migrationViolations([migration('delete from public.game_attempts;')])).toEqual([
      expect.stringContaining('DELETE FROM'),
    ]);
    expect(migrationViolations([migration(`
      do $$
      begin
        delete from public.game_attempts;
      end;
      $$;
    `)])).toEqual([
      expect.stringContaining('DELETE FROM'),
    ]);
  });

  it('keeps explicit production-data-loss approval behavior', () => {
    expect(migrationViolations([migration(`
      -- production-data-loss-approved: reviewed one-off cleanup
      delete from public.game_attempts;
    `)])).toEqual([]);
  });

  it('handles empty input deterministically', () => {
    expect(migrationExecutionSql()).toBe('');
    expect(migrationExecutionSql(null)).toBe('');
  });
});
