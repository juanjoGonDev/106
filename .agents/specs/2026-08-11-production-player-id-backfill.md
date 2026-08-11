# Production player_id backfill compatibility

Status: implemented; CI validation pending
Date: 2026-08-11
Branch: `agent/fix-production-player-id-backfill`
Base: `main` at `49d38bd385467f4d28e622b5cd9814ad9807e821`

## Incident

Production deployment run `31509990892` failed while applying `20260811133000_admin_restriction_nickname_management.sql`.

The failing statement was the `UPDATE public.game_players SET player_id = gen_random_uuid() WHERE player_id IS NULL` backfill. Production contains at least one legacy player row (`nick_key = 'ap'`, `nick = 'Ap'`) that predates the current nickname-shape constraint and is still valid historical data. PostgreSQL re-evaluates row CHECK constraints during UPDATE, so changing only `player_id` still rejected the legacy nickname with `SQLSTATE 23514` on `game_players_nickname_shape_check`.

The migration dry-run, migration safety guard and all pre-deployment configuration checks passed. Edge Function deployment and secret propagation were skipped because the database migration aborted first.

## Objective

Make the additive stable-player-ID migration compatible with legacy rows that may not satisfy current nickname CHECK constraints, without deleting, renaming or otherwise mutating historical player identity data.

## Decision

Do not rewrite the already-merged `20260811133000` migration. Add an interstitial migration, `20260811132900_prepare_legacy_player_id_backfill.sql`, that runs immediately before it and prepares `game_players.player_id` through DDL:

- add `player_id uuid default gen_random_uuid()` when the column is introduced;
- keep the canonical default for future inserts;
- enforce `NOT NULL` after the column exists;
- fail closed if any row is unexpectedly still null;
- do not normalize or rewrite legacy nicknames;
- do not weaken, drop or replace the existing nickname CHECK constraint;
- keep all downstream `player_id` ownership/backfill logic unchanged.

With every existing player already carrying a UUID, the historical `UPDATE ... WHERE player_id IS NULL` in `20260811133000` becomes a no-op instead of touching legacy nickname rows.

## Regression proof

The existing PostgreSQL migration-compatibility suite now models the production condition directly:

1. Insert a legacy row before a stricter CHECK exists.
2. Add the stricter CHECK as `NOT VALID`, preserving the historical row while enforcing it for future writes.
3. Add a UUID column with `DEFAULT gen_random_uuid()` and set it `NOT NULL`.
4. Verify the legacy row receives a non-null UUID and its nickname remains byte-for-byte unchanged.
5. Statically verify that the interstitial preparation migration uses `ADD COLUMN ... DEFAULT` and contains no `UPDATE public.game_players`.

## Changed files

- `supabase/migrations/20260811132900_prepare_legacy_player_id_backfill.sql`
- `scripts/test-migration-compatibility-local.mjs`
- `.agents/specs/2026-08-11-production-player-id-backfill.md`

## Acceptance criteria

- Production-shaped legacy nickname rows do not block `player_id` introduction.
- No historical nickname is rewritten or deleted.
- Existing nickname policy/check enforcement remains intact.
- `player_id` remains non-null and generated for existing/new players before `20260811133000` executes.
- Clean migration suite remains green.
- Security/admin integration remains green.
- Deployment migration guard remains green.
- A new non-draft PR targets `main`; no merge or production deployment is performed by this task.
