# Account daily attempt policy before nickname creation

## Status

Implementation in progress on `agent/fix-account-daily-attempt-policy`. No merge, deployment or production migration has been performed.

## Request

A newly confirmed account receives the authentication entitlement that raises its daily global allowance from five to six, but the home competition selector still renders `Global · 5/5 tiros` until a nickname exists. The quota calculation and presentation must share one canonical policy so account, player and browser states cannot drift.

## Evidence

- `get_game_daily_attempt_state` calculates the effective player quota only from a nickname.
- The account authentication flow grants the account-wide entitlement before the account necessarily owns a nickname.
- `player-context` returns `profile: null` for an available nickname and the browser then falls back to hard-coded `5` values in `competition.js`.
- The successful account synchronization response exposes the reward message but not the durable account-level daily-attempt policy.
- The screenshot supplied by the user shows a confirmed account without a nickname rendering `Global · 5/5 tiros`.

## Decision

1. Introduce a service-role-only database function that computes the account-wide daily-attempt policy once from the canonical account, referral entitlement and authentication entitlement sources.
2. Reuse that policy inside the existing nickname-specific daily state; nickname usage and reservations remain nickname-specific.
3. Expose the durable policy from successful account synchronization and merge confirmation responses.
4. Store the synchronized policy beside the local account credential, clear it whenever the account changes or signs out, and never derive the bonus from UI copy or authentication-provider assumptions.
5. Resolve the browser global scope through one pure daily-attempt state function: an actual nickname profile is authoritative; otherwise the synchronized account policy supplies the initial capacity.
6. Remove hard-coded global fallback values from `competition.js`. League limits remain independent and unchanged.
7. Preserve rolling compatibility: old backend responses without a policy safely fall back to the base quota, and old browser bundles continue to consume existing player profile fields.

## Acceptance criteria

1. A confirmed new account with no nickname renders `Global · 6/6 tiros`.
2. An unconfirmed, anonymous or legacy local account without an account policy renders `5/5`.
3. Once a nickname profile is loaded, its used, reserved, remaining and maximum values override the account-level fallback.
4. Referral and authentication account bonuses are calculated by the database policy and remain capped at ten total attempts.
5. The nickname-specific daily state reuses the account policy for shared account bonus, reset and ceiling fields.
6. Account synchronization and merge confirmation return the same policy and persist it only after the account token is settled.
7. Importing another account token or signing out clears the previous account policy before any UI render.
8. Malformed, missing or stale stored policy data fails safely to the base quota.
9. Pure decision and storage logic has deterministic 100% line, function and branch coverage.
10. Real local PostgreSQL validation proves a verified account with no players has a maximum of six and that adding players produces the same effective maximum.
11. Desktop and Mobile Playwright prove the no-nickname selector state, no horizontal overflow, and no page, console or failed-request errors.
12. Existing daily-limit, authentication, account-linking, reservation, league and anti-abuse tests remain green.

## Validation plan

- Extend `daily-attempt-limit.js` coverage for account-policy fallback and player-profile precedence.
- Extend account storage and cloud account service tests for persistence and clearing behavior.
- Add migration contract tests and local PostgreSQL assertions for account policy and nickname policy parity.
- Add Desktop and Mobile Playwright regression for a confirmed account with no nickname.
- Run syntax, ESLint, Knip, security, unit, coverage, full local Supabase matrix, authentication quality, browser quality and platform evidence workflows.

## Risks

- **Stale account data:** account policy is keyed to the local account credential lifecycle and cleared before token replacement or logout.
- **Mixed frontend/backend rollout:** missing policy fields fall back to five; player-specific backend enforcement remains authoritative.
- **Legacy per-nickname bonuses:** player profiles remain authoritative after nickname resolution. The no-nickname account policy intentionally represents account-wide referral and authentication entitlements only.
- **Race after confirmation:** synchronization writes the account token first, then the matching policy, and emits one account update after both values are consistent.

## Rollback

Revert the frontend and Edge Function changes. If the migration has reached production, add a forward migration that restores the previous `get_game_daily_attempt_state` body and leaves the additive helper functions unused. Do not rewrite an applied migration.

## Delivery

- Branch: `agent/fix-account-daily-attempt-policy`
- Base: current `main`
- One normal, non-draft pull request
- No merge, deployment, release or direct production mutation without explicit approval
