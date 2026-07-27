# Verified email daily bonus

## Status

Implementation in progress. Validation is pending.

## Request

Consume the confirmed-email account entitlement from the authentication work as one additional daily attempt while preserving the daily-attempt product contract: account-wide bonuses, race-safe reservations, UTC server reset and an absolute maximum of 10 attempts.

## Evidence

- Daily quota starts at 5 and uses `game_player_daily_bonus` to add up to 5 bonus attempts.
- Referral bonuses are account-wide and already resolve canonical merged accounts.
- Authentication is developed independently in PR #39, so this branch cannot depend on that migration being merged first.
- A repeated or concurrent email callback must never increase the quota more than once.

## Decisions

1. Define the same additive `game_account_entitlements` table in both branches with `create table if not exists`, identical columns and permissions. Either PR can merge first.
2. The entitlement code is `verified_email_daily_attempt` and is unique per source account.
3. Daily lookup resolves entitlement account IDs through `daily_game_account_id`, so an entitlement survives account merging without becoming stackable.
4. Email confirmation adds exactly 1 to the existing bonus calculation.
5. `least(5, ...)` remains authoritative for total bonus attempts. Base 5 plus bonus 5 keeps the absolute maximum at 10.
6. The daily state exposes `emailVerificationBonus` as 0 or 1 for transparent UI and diagnostics.
7. The entitlement table and helper RPC remain service-role-only and deny `PUBLIC`, `anon` and `authenticated`.

## Acceptance criteria

1. An account without the entitlement has base maximum 5.
2. Adding the entitlement changes every nickname on that account to maximum 6 when no other bonuses exist.
3. Inserting the same entitlement again cannot stack it.
4. The email bonus combines with referrals and legacy valid bonuses but total bonus remains capped at 5.
5. Absolute daily maximum remains 10.
6. `get_game_daily_attempt_state` exposes `emailVerificationBonus` and consistent `bonusAttempts`, `maxAttempts` and `attemptsLeft`.
7. Real local PostgreSQL integration validates the account-wide bonus, replay resistance and cap.
8. CI permission checks cover the new table/function.
9. All existing daily race, reservation, multi-tab and Playwright tests continue passing.
10. PR #40 remains independent of PR #39 and does not enable OAuth or email signup itself.

## Validation plan

- `pnpm check`
- `bash scripts/run-supabase-ci.sh`
- Daily local integration including the new entitlement journey
- Existing daily Desktop/Mobile Playwright evidence
- GitHub Actions quality and browser workflows

## Rollback

Revert the new quota migration and test wiring before deployment. After deployment, use a new forward migration to redefine the bonus function without the entitlement contribution; never rewrite an applied migration.

## Delivery

- Existing daily-limit branch and normal PR #40 are reused.
- No merge, production migration, deployment or release without explicit authorization.
