# Trophies and achievements

## Daily award lifecycle

Daily awards use the `Europe/Madrid` calendar. The current day remains provisional and is rendered from verified global attempts without inserting rows. A day becomes eligible only after midnight in Madrid.

`sync_game_trophy_history()` serializes processing with a PostgreSQL advisory transaction lock. For each closed, unprocessed date it calls `award_game_trophies_for_date()`, persists at most one winner per category, refreshes achievements for the affected players, and records the run in `game_trophy_award_runs`.

The migration ends by invoking the synchronization function. This backfills all historical verified global attempts during deployment. `get_game_stats()` and `get_game_player_profile()` also invoke the same idempotent synchronization, so a missed deployment run is repaired by the next normal read.

## Categories

- **Golden Boot:** lowest verified global difference of the day.
- **Golden Glove:** lowest daily average among players with at least three verified global attempts.
- **Golden Ball:** most verified global attempts, then best difference, average, earliest best result, and normalized nickname.

League attempts and excluded attempts never participate.

## Achievements

Achievements are append-only and uniquely keyed per player and achievement code. Current families cover:

- first trophy;
- total trophy thresholds;
- per-category thresholds;
- consecutive trophy-day streaks;
- first winner of each category in a calendar month;
- owning all three trophy categories;
- winning all three categories on one day.

## Deployment and rollback

Production applies the migration incrementally through `supabase db push`; no reset or destructive schema command is used. Pre/post deployment snapshots include award runs, trophies and achievements as monotonic metrics.

The migration is additive. Application rollback can stop reading the new JSON fields without removing data. Schema rollback must not delete the new tables in production; use a forward migration after reviewing stored history and backup/PITR availability.
