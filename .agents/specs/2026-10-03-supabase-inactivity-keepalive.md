# Supabase inactivity keepalive

## Request

Keep the production Supabase Free Plan project active without writing product data by generating a small amount of real database-backed read traffic every day. Activity must not happen at one fixed time or repeat one identical read sequence every time, while still targeting at least three successful activity runs per local day.

## Evidence

- The public application is GitHub Pages backed by Supabase Edge Functions and PostgreSQL.
- The existing `SUPABASE_FUNCTIONS_URL` GitHub Actions variable points at the production `game-api` Edge Function.
- `game-api` exposes the unauthenticated `stats` action, which reads `get_game_stats` and `get_game_daily_awards`.
- `public-profile` and `nick-status` read `get_game_player_profile` for a validated nickname.
- These actions are database-backed reads and do not mutate gameplay, account, league, ranking, or audit state.
- GitHub Actions scheduled workflows support IANA timezones.
- GitHub-hosted schedules can be delayed or dropped, and scheduled workflows in public repositories can be disabled after 60 days without repository activity.

## Decision

- Add eight candidate schedules per day in `Europe/Madrid`, deliberately away from the start of the hour.
- Use a pure planner with a daily target of three successful runs.
- Before each candidate, list short-lived keepalive marker artifacts for the current Madrid calendar date.
- Skip once three successful markers already exist.
- While enough candidate slots remain, choose probabilistically using `needed / remainingSlots`.
- When the remaining candidate count is equal to or below the number still needed, run the candidate instead of randomly skipping it.
- Persist a marker only after the database-backed reads succeed. A failed run therefore leaves the daily count unchanged and later candidates can still compensate.
- Keep coordination state in GitHub Actions artifacts for two days. Do not create a Supabase counter, table, row, cache entry, branch commit, issue, or other persistent product state.
- Rotate among `stats`, `leader-profile`, and `random-profile`. Each mode is used at most once before any mode can repeat.
- Every selected mode performs `stats`. Profile modes additionally read a player profile from the current leaderboard, or use a harmless fallback nickname when no ranked player exists.
- Use only the existing public `SUPABASE_FUNCTIONS_URL` variable. Add no secret.
- Grant the workflow only `actions: read` and `contents: read`.
- Reuse repository-pinned action revisions.
- Do not add an auto-commit heartbeat solely to keep GitHub schedules enabled. That would require write permission, create unrelated repository history, and trigger other workflows.
- Do not use a browser or Playwright for the production keepalive. Direct read-only API traffic exercises the database boundary with less cost and fewer failure modes.

## Acceptance

- The workflow defines eight candidate schedules in `Europe/Madrid`.
- The daily success target is three.
- Successful markers are scoped by Madrid local date and retained for only two days.
- A candidate skips after the daily target has already been reached.
- Early candidates may execute or skip randomly.
- Late candidates become mandatory when every remaining slot is needed to reach the target.
- No marker is uploaded after a failed database read.
- Activity modes do not repeat until all three modes have been used.
- All production requests are read-only database-backed actions.
- No product database state, repository file, issue, or secret is used as a counter.
- Workflow permissions are read-only and all third-party actions are pinned to full commit SHAs.
- Missing or non-HTTPS `SUPABASE_FUNCTIONS_URL` fails closed.
- HTTP failures and malformed responses fail the selected candidate.
- Planner and workflow contract tests cover the new decision logic with 100% line, function, and branch coverage.
- Pull Request Quality Pipeline is green on the final PR head.

## Risks

- GitHub documents that scheduled workflows can be delayed or dropped under high load. No GitHub-hosted cron design can guarantee three physical executions if GitHub does not dispatch enough candidate events.
- GitHub documents that scheduled workflows in public repositories are automatically disabled after 60 days without repository activity. This repository therefore still needs normal repository activity or manual re-enablement before that threshold when otherwise dormant.
- The adaptive planner guarantees three selections only when the required scheduled events are dispatched and the production API succeeds. Network/API retries reduce transient risk but cannot compensate for a missing final scheduler event.
- Supabase can change Free Plan inactivity policy. The workflow should remain low-volume and be revisited if the provider policy changes.

## Tests

- Unit/contract tests for date scoping, schedule mapping, random execution, forced late execution, target completion, mode rotation, marker naming, and invalid inputs.
- Contract test for workflow schedules, timezone, permissions, variable usage, and pinned actions.
- Node syntax check for the planner.
- 100% line/function/branch coverage for the planner.
- Existing repository lint, Knip, security, package-policy, unit, and Supabase integration checks through the normal PR pipeline.

## Rollback

Revert this pull request. Marker artifacts expire automatically and no Supabase product state requires cleanup.

## Delivery

Branch `agent/supabase-inactivity-keepalive`; one normal non-draft pull request to `main`. Do not merge, deploy, publish, or mutate production manually without explicit user authorization.

## Status

Implementation in progress.
