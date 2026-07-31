# Lifetime player reliability regression

## Status

Implementation is complete on `agent/fix-lifetime-reliability` in PR #58. Final-head CI, platform evidence packaging and the PR evidence contract are in progress. No merge, deployment, release or production migration has been performed.

## Request

After PR #57 was merged, the public player radar can show `Fiabilidad` as zero immediately after the daily reset even when the player has many historical valid attempts. Restore every lifetime radar statistic without changing the current-day quota behavior.

## Evidence

- The merged radar calculates Fiabilidad as `verifiedAttempts / attemptsUsed`.
- `verifiedAttempts` is a lifetime profile aggregate.
- `attemptsUsed` is overwritten by `get_game_daily_attempt_state()` and therefore represents only the current `Europe/Madrid` server day.
- At 01:48 after the daily reset, a player with previous valid attempts can receive `attemptsUsed = 0` and `verifiedAttempts > 0`; the browser consequently renders Fiabilidad as `0/100`.
- The account-player projection already avoids this collision by exposing `lifetimeAttemptsUsed` separately before overlaying current-day quota fields.

## Decision

1. Keep `attemptsUsed`, `attemptsLeft`, `maxAttempts` and `dailyResetAt` as current-day quota fields.
2. Add `lifetimeAttemptsUsed` to the canonical public profile through a new forward-only migration; do not rewrite the applied daily-limit migration.
3. Build the lifetime count from all global attempts for the nickname, matching the existing lifetime `verifiedAttempts`, best and average metrics.
4. Calculate Fiabilidad from `verifiedAttempts / lifetimeAttemptsUsed` in both the browser radar and generated social card.
5. During rolling deployment, fall back to legacy `attemptsUsed` only when `lifetimeAttemptsUsed` is absent. An explicit lifetime value of zero must not fall back to current-day usage.
6. Keep Experiencia based on lifetime `verifiedAttempts`; no scoring formula changes beyond correcting the Fiabilidad denominator.
7. Explain Fiabilidad as a lifetime ratio so the UI cannot imply that the denominator is today’s quota usage.

## Acceptance criteria

1. A profile with `attemptsUsed = 0`, `lifetimeAttemptsUsed = 17` and `verifiedAttempts = 17` renders Fiabilidad `100/100`.
2. The same profile retains Experiencia `85/100` and all other radar scores.
3. A profile with 8 valid attempts out of 10 lifetime attempts renders Fiabilidad `80/100` regardless of current-day usage.
4. An explicit `lifetimeAttemptsUsed = 0` renders zero reliability and does not fall back to a nonzero daily value.
5. Older backend payloads without `lifetimeAttemptsUsed` remain compatible by using `attemptsUsed`.
6. The browser explanation displays the valid and lifetime attempt counts and states that today’s quota reset does not erase the history.
7. The Edge-generated player card uses the same lifetime denominator as the browser.
8. The public profile RPC exposes both lifetime and daily counters after a Spain-midnight reset.
9. Real local PostgreSQL coverage proves previous-day attempts remain in lifetime totals while current-day `attemptsUsed` resets to zero.
10. Desktop and Mobile Playwright reproduce the post-reset payload and verify Fiabilidad, accordion copy, accessibility, no horizontal overflow and no browser/network errors.
11. Unit, contract, migration, local Supabase, security, lint, dead-code and full-platform evidence checks pass on the final PR head.

## Risks

- **Rolling deployment:** the frontend must accept old payloads while the migration propagates; the legacy fallback is field-presence based rather than truthiness based.
- **Metric drift:** browser and social-card renderers must resolve the same denominator and remain covered by a parity contract.
- **Scope drift:** lifetime totals include global attempts only, matching existing public-profile aggregates; league attempts remain excluded.
- **Migration safety:** use a new `create or replace function` migration and preserve existing grants. Applied migrations are not edited.
- **Cache:** version the modified browser radar entrypoint so deployed clients do not retain the broken denominator.

## Tests

- Unit regression for post-reset daily/lifetime field collision, legacy fallback, partial validity and explicit zero.
- Static parity contract for browser and Edge lifetime-denominator resolution.
- Forward-migration contract for lifetime field construction, right-side daily overlay and service-role-only execution.
- Real local PostgreSQL journey with previous-day verified attempts and zero current-day usage.
- Desktop and Mobile Playwright with a realistic post-reset public profile.
- Complete repository quality, Supabase and platform-evidence workflows.

## Validation

Pre-final head `642f5505afc26d14abe833f6c35d15265d225e41` passed unit/security, lint, Knip, build/syntax, dependency policy, CodeQL, authentication, public-asset audit, database migration, gameplay-core and complete Desktop/Mobile player-platform workflows. One isolated Supabase sharing job failed before executing tests because the runner could not bind local port `54322`; that infrastructure collision was retried rather than addressed with a code change. The definitive validation source is the newer final PR head produced by this specification update.

## Rollback

Revert browser and Edge changes normally. If the migration has reached production, add a new forward migration restoring the previous profile projection; never rewrite or delete the applied migration. The additive JSON field does not require deleting persisted data.

## Delivery

- Branch: `agent/fix-lifetime-reliability`
- Base: `main` at merged PR #57
- Pull request: #58, normal and non-draft
- No merge, deployment, production migration or release without explicit approval
