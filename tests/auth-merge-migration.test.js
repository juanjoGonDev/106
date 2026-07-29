import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migrationPath = 'supabase/migrations/20260727120200_auth_merge_pgcrypto_search_path.sql';

describe('account merge fingerprint migration', () => {
  it('keeps pgcrypto available inside both SECURITY DEFINER merge functions', () => {
    const sql = readFileSync(migrationPath, 'utf8').replaceAll(/\s+/g, ' ').toLowerCase();

    expect(sql).toContain(
      'alter function public.prepare_game_auth_link(uuid, text, text, boolean, text, text) set search_path = public, extensions, pg_temp;',
    );
    expect(sql).toContain(
      'alter function public.confirm_game_auth_merge(uuid, uuid, text) set search_path = public, extensions, pg_temp;',
    );
  });
});
