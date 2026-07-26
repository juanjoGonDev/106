# Finish awards and multi-tab attempt reservations

## Request

- Fix the daily-awards card becoming `Aún sin dueño` immediately after a completed attempt.
- Determine whether several prepared browser tabs can bypass the five-attempt budget.
- Prevent concurrent tabs from reserving more challenges than the remaining global or league attempt budget.
- Add deterministic frontend and real Supabase integration coverage.

## Evidence

- The `stats` API action combines `get_game_stats()` with `get_game_daily_awards()`, but the `finish` action returns only `get_game_stats()`.
- `public/app.js` commits the `finish` response into `Minuto106HomeStats`; `public/ranking-enhancements.js` interprets a missing `awards` property as three empty awards and renders `Aún sin dueño`.
- The database serializes finalization per player and competition and rechecks persisted attempts, so more than the allowed number of attempts cannot currently be stored.
- Challenge creation checks only persisted attempts. Several tabs can therefore create multiple unconsumed challenges before any of them finishes, leaving more prepared challenges than the remaining budget.

## Decision

1. Make `get_game_stats()` itself include `get_game_daily_awards()`. Every stats consumer, including the `finish` response, receives one complete snapshot.
2. Keep the frontend resilient during rolling deployments: when a committed snapshot omits `awards`, retain the last authoritative awards instead of replacing them with empty placeholders.
3. Wrap `start_game_challenge_pointer_only` with a reservation check after the existing challenge creation logic has acquired the competition advisory lock. Count persisted attempts plus unconsumed, unexpired challenges in the same competition.
4. If the new challenge would exceed the budget, mark that unexposed challenge as consumed in the same transaction and return the existing `nick_limit` contract. This releases capacity without deleting its audit row.
5. Preserve the successful start response contract and the finalization-side limit check as a second authoritative guard.

## Scope

- Additive PostgreSQL migration only; no applied migration is rewritten.
- Shared home-statistics coordinator and daily-awards subscriber.
- Unit, browser and local Supabase integration coverage.
- Package scripts and syntax registration for the focused integration journey.

## Risks

- Existing active challenges created before deployment may temporarily fill all remaining reservations until they are consumed or expire.
- Renaming wrapped PostgreSQL functions must preserve their implementation and keep the new public names restricted to `service_role`.
- A partial snapshot from an older Edge Function must not erase newer award data during a rolling deployment.

## Acceptance

- [x] A successful `finish` response contains `stats.awards`.
- [x] Committing a partial finish snapshot cannot render valid daily awards as `Aún sin dueño`.
- [x] Five available attempts allow at most five simultaneous active challenges in the same competition.
- [x] A sixth concurrent challenge returns the existing attempt-limit error and retains only a consumed audit row.
- [x] Global and league reservations remain isolated.
- [x] Expired or consumed challenges do not reserve capacity.
- [x] Successful start responses remain backward compatible.
- [x] Finalization still prevents more persisted attempts than the configured budget.
- [x] Unit, browser, security, migration and local Supabase checks pass.

## Validation

Validated on implementation head `e856053640cb50182da5a1f5abf82cf230ae8961`:

- Pull Request Quality Pipeline run `30198820052`: passed, including syntax, ESLint, Knip, Vitest, security and dependency policy checks, migration validation, and the complete local Supabase API journey.
- The new local Supabase concurrency journey created five active challenges for one player, rejected the sixth with `nick_limit`, finalized one attempt, verified the complete `stats.awards` snapshot, and confirmed that the persisted attempt plus the four remaining active challenges still exhausted the budget.
- Player Pages and Social Cards run `30198820044`: passed, including strict frontend coverage, responsive desktop/mobile Playwright journeys, the partial-finish awards regression, and lifecycle recording.
- Public Asset Audit run `30198820046`: passed.
- Pull Request Visual Evidence run `30199509978`: passed after validating the immutable desktop, mobile, and GIF evidence embedded in PR #35 without executing pull-request code.
- Current-head full-resolution browser evidence is retained in artifact `frontend-previews-30198820044`, artifact ID `8631010818`, digest `sha256:9b9d0ccc8c4ac81c47e3e66acfccc245068a3d76e9050af6b720e83953343d72`.
- Immutable inline previews are published outside the feature branch at evidence commit `9b794b029df298d6a0e13ca87e2ec555d83026b6`.

## Rollback

- Revert the frontend and test changes.
- Do not delete or rewrite the applied migration. Add a forward corrective migration that restores the previous function wrappers if rollback is required after deployment.

## Delivery

- Branch: `agent/fix-finish-awards-multitab-budget`
- Pull request: `#35`
- Evidence branch: `pr-evidence/35`
- Merge: not authorized
- Deployment: not authorized

## Status

Complete and ready for review. PR #35 remains open, unmerged, and undeployed.
