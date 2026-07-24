import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260724213400_honours_progress_featured_achievements.sql',
  'utf8',
);

describe('featured achievement replacement serialization', () => {
  it('locks each player selection transaction before deactivating active slots', () => {
    const lock = migration.indexOf('pg_advisory_xact_lock(hashtextextended(p_nick_key, 10603))');
    const deactivate = migration.indexOf('update public.game_player_featured_achievements');
    expect(lock).toBeGreaterThan(-1);
    expect(deactivate).toBeGreaterThan(lock);
  });
});
