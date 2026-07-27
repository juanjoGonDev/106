# Daily attempt and referral limits

## Status

Implementation in progress.

## Request

- Reset the global attempt limit every server day.
- When a nick exhausts its daily global quota, show a live countdown to the next reset.
- Each distinct referred game account that completes five verified global attempts increases the referrer account's daily quota by one for every linked nick.
- Cap the resulting quota at ten attempts per nick and server day.
- Prove the behavior against fraud, duplicate rewards, multiple nicks, multiple tabs and transaction races with complete changed-logic coverage and real local database/API tests.

## Evidence

- Global limits are currently lifetime counters by `nick_key`; daily fields do not exist on challenges or attempts.
- Referral rewards are currently keyed to one referrer nick and increment `game_player_bonus`, so another nick on the same account does not inherit the reward.
- `game_referrals.referred_nick_key` prevents duplicate rewards for one nick but does not prevent one account from presenting several nicks as independent referred users.
- The current reservation wrapper serializes one nick and competition scope, then counts persisted attempts plus active unexpired challenges. This is the correct concurrency boundary to retain.
- Miniligas are fixed-duration competitions with five attempts per member. Resetting those attempts every day would change league fairness and is outside this request.

## Decision

1. A server day is the UTC calendar day calculated by PostgreSQL. The API returns the exact next UTC reset timestamp; the browser never guesses the server timezone.
2. The daily reset applies to the global competition only. Miniliga attempt budgets remain five per league for the full league duration.
3. The base daily global quota is five per nick. A canonical game account earns one additional daily attempt for each eligible completed referral, capped at five bonus attempts and ten total attempts.
4. The account bonus is projected onto every linked nick. It is derived from completed account-level referrals rather than trusting a mutable client counter.
5. A referral is eligible only when referrer and referred players belong to different game accounts, use distinct original device/IP evidence, and the referred account has not already consumed an eligible referral through another nick.
6. Referral qualification requires five verified global attempts across the referred account's linked nicks. League and unverified attempts do not qualify.
7. Challenges and attempts persist an immutable `quota_day`. Active reservations and completed attempts are counted in that day. Activation revalidates and moves a prepared challenge to the current server day atomically, preventing pre-midnight reservations from creating post-reset extra attempts.
8. Start, activation, finish and referral completion use transaction advisory locks and uniqueness constraints. Duplicate or concurrent requests cannot exceed quota or complete a referral more than once.
9. Historical attempts are backfilled to their UTC creation day. Historical referrals are mapped to accounts; only the earliest valid referral per referred account remains reward-eligible.
10. The frontend renders a dedicated exhausted-limit card, exact `HH:MM:SS` countdown, account bonus progress and automatic context refresh at reset.

## Scope

### Database

- Add and backfill `quota_day` on global challenges and attempts.
- Add account identity and eligibility metadata to referrals.
- Add daily/account helper functions, referral registration/completion functions and indexes/constraints.
- Replace global start, reservation, activation and finish quota decisions while preserving anti-cheat, rate limits and league behavior.
- Wrap public player/account projections with daily attempt and account-wide bonus fields.

### Frontend

- Add isolated daily-limit normalization/countdown logic.
- Add responsive exhausted-limit UI and automatic reset refresh.
- Update product, referral and share copy from lifetime/one-off attempts to daily/account-wide rules.

### Validation

- 100% line/function/branch coverage for the isolated daily-limit module.
- SQL contract tests for day pinning, account referral uniqueness, cap, locks, privileges and rolling compatibility.
- Real local PostgreSQL/API tests for previous-day exclusion, current-day exhaustion, cross-nick account bonus, duplicate-account referral rejection, concurrent completion and multi-tab reservations.
- Desktop and Mobile Playwright journey with complete PNG, WebM and GIF evidence for the countdown state.

## Acceptance criteria

1. Five current-day global attempts exhaust an unbonused nick; attempts from previous UTC days do not.
2. The returned profile exposes daily used, reserved, left, max and reset timestamp consistently.
3. The sixth concurrent global reservation is rejected when five current-day slots are already completed or active.
4. Resetting the server day makes a new quota available without deleting historical attempts.
5. One eligible referred account completing five verified global attempts adds exactly one daily attempt to every referrer-account nick.
6. Several nicks from the same referred account cannot create several rewards.
7. Self-account, same-device, same-IP, league-only and unverified activity never earns a referral bonus.
8. Concurrent fifth-attempt completions produce one referral completion and one account bonus.
9. The daily maximum never exceeds ten even with more than five completed referrals.
10. Exhausted Desktop and Mobile views show an accurate live countdown, remain responsive/accessibile and refresh automatically at zero.
11. No direct browser role gains table or helper-function privileges.
12. Existing league attempt limits, ranking history, awards and anti-cheat validation remain intact.

## Risks and rollback

- **Midnight race:** immutable quota days plus activation revalidation prevent reservations crossing the reset boundary from being double-spent.
- **Referral farming:** account identity, partial uniqueness, device/IP checks and verified-global qualification prevent multi-nick and self-referral duplication.
- **Rolling deployment:** old clients accept additional JSON fields. New profile wrappers retain all previous fields and only replace attempt-limit fields.
- **Historical data:** migrations are additive and backfilled. No attempts or referrals are deleted.
- **Rollback:** revert frontend/API behavior. Applied schema changes remain dormant; restore behavior with a forward corrective migration rather than rewriting or deleting this migration.

## Delivery

- One branch: `agent/feat-daily-attempt-referral-limits`.
- One normal, non-draft pull request independent from PR #39.
- Conventional Commit history.
- No merge, production migration, deployment or release without explicit authorization.
