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

- Local JavaScript/MJS syntax, shell syntax, JSON parsing and SQL safety checks passed.
- Vitest contracts cover trophy SQL, sharing and explicit post-check start.
- Supabase integration fixtures cover deterministic awards, exclusions, ties, idempotency, audit runs, dated history, thresholds, category achievements, seven-day streaks, monthly firsts, complete set, daily hat trick, rankings and provisional current day.
- GitHub Actions run `29916662647` passed build, package policy, syntax, Vitest, ESLint, Knip, dependency/security policy, PostgreSQL lint, migration history, full database rebuild, Edge Function and API integration, and the final quality gate.
- Production snapshot comparison now guards award runs, trophies and achievements as monotonic data.

## Delivery

- Branch: `agent/feat-trophies-achievements-sharing`
- Pull request: `#9`
- Migrations: `20260722160000` through `20260722160300`
- Deployment remains automatic only after merge to `main`; this task does not merge or deploy.

## Status

Ready for review. Acceptance criteria are implemented and the complete pull-request quality pipeline is green. Production remains unchanged until the pull request is merged and the deployment workflow applies the additive migrations.
