# Authentication daily bonus consumption

## Status

Implementation complete. Final-head validation is pending.

## Request

Consume the account-level authentication entitlement from PR #39 as one additional daily attempt while preserving the daily-attempt contract: account-wide bonuses, race-safe reservations, UTC server reset and an absolute maximum of 10 attempts.

The entitlement may originate from confirmed normal email or from the first Google/Facebook link. Google and Facebook share one reward, and an email-origin account does not receive another reward after linking social providers.

## Evidence

- Daily quota starts at 5 and uses `game_player_daily_bonus` to add up to 5 bonus attempts.
- Referral bonuses are account-wide and already resolve canonical merged accounts.
- Authentication is developed independently in PR #39, so this branch cannot depend on that migration being merged first.
- PR #39 uses the unified code `auth_identity_daily_attempt` and retains the legacy `verified_email_daily_attempt` code during rolling deployment.
- Replayed callbacks, multiple providers and concurrent confirmations must never increase quota more than once.

## Decisions

1. Define the additive `game_account_entitlements` table in both branches with `create table if not exists`, identical columns and permissions. Either PR can merge first.
2. The current entitlement code is `auth_identity_daily_attempt`; `verified_email_daily_attempt` remains readable for rolling compatibility.
3. Daily lookup resolves entitlement account IDs through `daily_game_account_id`, so rewards survive account merging without stacking.
4. Any eligible authentication origin contributes exactly 1 to the existing bonus calculation.
5. The primary key `(account_id, entitlement_code)` and PR #39’s canonical reward lock prevent replay and provider stacking.
6. `least(5, ...)` remains authoritative for all bonus attempts. Base 5 plus bonus 5 keeps the absolute maximum at 10.
7. Daily state exposes `authRewardBonus` as 0 or 1. `emailVerificationBonus` remains as a temporary compatibility alias with the same value.
8. The entitlement table and helper RPCs remain service-role-only and deny `PUBLIC`, `anon` and `authenticated`.
9. This branch does not decide eligibility; it only consumes an already granted canonical entitlement.

## Acceptance criteria

1. An account without an entitlement has base maximum 5.
2. Adding `auth_identity_daily_attempt` changes every nickname on the account to maximum 6 when no other bonuses exist.
3. Re-inserting the same entitlement cannot stack it.
4. Google then Facebook still produces one quota bonus because PR #39 creates one canonical entitlement.
5. Email-origin then social still produces one quota bonus.
6. Legacy `verified_email_daily_attempt` remains readable during rolling deployment.
7. Authentication bonus combines with referrals and legacy valid bonuses while total bonus stays capped at 5.
8. Absolute daily maximum remains 10.
9. `get_game_daily_attempt_state` exposes `authRewardBonus`, compatibility `emailVerificationBonus`, and consistent `bonusAttempts`, `maxAttempts` and `attemptsLeft`.
10. Real local PostgreSQL integration validates account-wide propagation, replay resistance, legacy compatibility and cap.
11. CI permission checks cover the table and helper functions.
12. All daily race, reservation, multi-tab and Playwright tests continue passing.
13. PR #40 remains independent of PR #39 and does not enable Auth itself.

## Validation plan

- `pnpm check`
- `bash scripts/run-supabase-ci.sh`
- Authentication entitlement local integration
- Existing daily Desktop/Mobile Playwright evidence
- GitHub Actions quality and browser workflows

## Rollback

Before deployment, revert the quota migration and test wiring. After deployment, use a new forward migration to redefine the bonus function without the entitlement contribution; never rewrite an applied migration.

## Delivery

- Existing daily-limit branch and normal PR #40 are reused.
- No merge, production migration, deployment or release without explicit authorization.
