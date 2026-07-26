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
4. If the new challenge would exceed the budget, delete that unexposed challenge in the same transaction and return the existing `nick_limit` contract.
5. Preserve the finalization-side limit check as a second authoritative guard.

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

- [ ] A successful `finish` response contains `stats.awards`.
- [ ] Committing a partial finish snapshot cannot render valid daily awards as `Aún sin dueño`.
- [ ] Five available attempts allow at most five simultaneous active challenges in the same competition.
- [ ] A sixth concurrent challenge returns the existing attempt-limit error.
- [ ] Global and league reservations remain isolated.
- [ ] Expired or consumed challenges do not reserve capacity.
- [ ] Finalization still prevents more persisted attempts than the configured budget.
- [ ] Unit, browser, security, migration and local Supabase checks pass.

## Validation

Pending implementation and CI execution.

## Rollback

- Revert the frontend and test changes.
- Do not delete or rewrite the applied migration. Add a forward corrective migration that restores the previous function wrappers if rollback is required after deployment.

## Delivery

- Branch: `agent/fix-finish-awards-multitab-budget`
- Pull request: pending
- Merge/deploy: not authorized

## Status

In progress.
