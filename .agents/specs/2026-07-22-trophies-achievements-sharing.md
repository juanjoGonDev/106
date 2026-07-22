# Trophies, achievements, sharing and explicit post-check start

## Request

Add persistent daily Golden Boot, Golden Glove and Golden Ball awards; public dated trophy history and counts; achievements for totals, categories, consecutive days and monthly firsts; trophy and achievement rankings; shareable public profiles; share-first actions instead of clipboard copying; and an explicit user start after the numbered-ball verification without layout shifts.

## Evidence

- The existing database calculated daily awards ephemerally in `get_game_daily_awards()`.
- Existing award semantics were already defined and are preserved.
- Global and league attempts are separated by `game_attempts.league_id`.
- Visible share actions mixed Web Share and clipboard fallbacks.
- `human-check.js` forwarded the start request automatically after the fourth ball.
- Production deployment already uses additive `supabase db push`, migration guards and pre/post snapshots.

## Decision

- Persist only closed Madrid calendar days; keep the current day provisional.
- Materialize awards idempotently with one row per date/category and an award-run ledger.
- Backfill in the additive migration and lazily synchronize on stats/profile reads.
- Derive append-only achievements from persisted trophies.
- Return honours history and rankings through existing stats/profile RPC contracts.
- Use a shared Web Share / destination-dialog surface and remove clipboard use from visible share flows.
- Keep the numbered-ball proof, but require a distinct trusted click on `Empezar intento` before forwarding `start`.

## Scope

- Add trophy, award-run and achievement tables, indexes, RLS and RPCs.
- Extend profile and stats JSON contracts.
- Add honours UI to current profile, public overlay and ranking page.
- Add trophy and achievement rankings and public `?nick=` links.
- Replace challenge, result, referral and league sharing surfaces.
- Stabilize visual-check layout and explicit continuation.
- Extend production integrity snapshots.

## Risks

- Historical backfill could be expensive on a very large attempt table. Mitigation: process distinct dates once, use global verified filters and persist run markers.
- Concurrent reads could duplicate processing. Mitigation: transaction advisory lock plus unique constraints.
- Ranking/profile ranks could diverge. Mitigation: shared deterministic ordering criteria.
- A current-day winner could be presented as final. Mitigation: explicit `provisional: true` and no current-day persistence.
- Browser share support varies. Mitigation: first-party destination dialog without clipboard dependency.

## Acceptance criteria

- Closed daily awards survive reloads and deployments with date and category.
- Current-day awards are provisional and cannot be persisted.
- League and unverified attempts cannot win.
- Trophy and achievement counts/history are visible on own and public profiles.
- Direct public profile URLs load by nickname.
- Rankings exist for precision, trophies and achievements.
- Challenge/result/referral/league/profile actions open sharing rather than copy text.
- Solving the visual check never starts the timer until the explicit start button is pressed.
- The check panel keeps stable dimensions while counter and button states change.
- Fresh migration rebuild, incremental migration, lint, unit/security tests and integration journey pass in CI.

## Validation

- JavaScript syntax checks for every changed JS/MJS file.
- Static Vitest contracts for trophy SQL, sharing and explicit post-check start.
- Supabase integration fixtures for deterministic awards, exclusions, idempotency, dated history, thresholds, category achievements, streaks, monthly firsts, complete set, daily hat trick, rankings and provisional current day.
- PostgreSQL lint, migration history and full database rebuild in the existing Supabase CI job.
- Production snapshot comparison extended with award runs, trophies and achievements.

## Delivery

- Branch: `agent/feat-trophies-achievements-sharing`
- Migrations: `20260722160000` through `20260722160300`
- Deployment remains automatic only after merge to `main`; this task does not merge or deploy.

## Status

Implementation prepared; local syntax validation complete. Full pnpm/Supabase execution requires CI because this environment has no package registry, Supabase CLI, PostgreSQL or Docker access.
