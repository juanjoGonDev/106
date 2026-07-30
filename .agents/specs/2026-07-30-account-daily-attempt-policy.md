# Account daily attempt policy before nickname creation

## Status

Implementation and regression coverage are complete on `agent/fix-account-daily-attempt-policy` and delivered through PR #56. The substantive code head passed repository, local Supabase, security and browser validation; the final documentation-only head must retain those gates before merge. No merge, deployment or production migration has been performed.

## Request

A newly confirmed account receives the authentication entitlement that raises its daily global allowance from five to six, but the home competition selector still renders `Global · 5/5 tiros` until a nickname exists. The quota calculation and presentation must share one canonical policy so account, player and browser states cannot drift.

## Evidence

- `get_game_daily_attempt_state` calculated the effective player quota only from a nickname.
- The account authentication flow granted the account-wide entitlement before the account necessarily owned a nickname.
- `player-context` returned `profile: null` for an available nickname and the browser then fell back to hard-coded `5` values in `competition.js`.
- The successful account synchronization response exposed the reward message but not the durable account-level daily-attempt policy.
- Existing confirmed sessions created before this fix had no cached policy and needed a server refresh independent of nickname creation.
- The screenshot supplied by the user showed a confirmed account without a nickname rendering `Global · 5/5 tiros`.

## Decision

1. Introduce a service-role-only database function that computes the account-wide daily bonus once from the canonical account, referral entitlement and authentication entitlement sources.
2. Build the account daily-attempt policy from that bonus and reuse it inside the existing nickname-specific daily state; nickname usage and reservations remain nickname-specific.
3. Expose the durable policy from account session, successful synchronization and merge confirmation responses.
4. Expose the same policy through the private account token on `player-context` so already-confirmed browsers recover the correct limit without creating a nickname or repeating authentication.
5. Store synchronized policy beside the local account credential, clear it whenever the account changes or signs out, and never derive the bonus from UI copy or authentication-provider assumptions.
6. Resolve the browser global scope through one pure daily-attempt state function: an actual nickname profile is authoritative; otherwise the refreshed or synchronized account policy supplies the capacity.
7. Remove hard-coded global fallback values from `competition.js`. League limits remain independent and unchanged.
8. Preserve rolling compatibility: missing or malformed policy data safely falls back to the base quota, and old browser bundles continue to consume existing player profile fields.

## Acceptance criteria

1. A confirmed account with no nickname renders `Global · 6/6 tiros`, including accounts confirmed before deployment that only retain their private account token.
2. An unconfirmed, anonymous or legacy local account without an account policy renders `5/5`.
3. Once a nickname profile is loaded, its used, reserved, remaining and maximum values override the account-level fallback.
4. Referral and authentication account bonuses are calculated by the database policy and remain capped at ten total attempts.
5. The nickname-specific daily state reuses the account policy for shared account bonus, reset and ceiling fields.
6. Account synchronization and merge confirmation return the same policy and persist it only after the account token is settled.
7. Importing another account token or signing out clears the previous account policy before any UI render.
8. Malformed, missing or stale stored policy data fails safely to the base quota and can be refreshed from the server when a valid private account token exists.
9. Pure decision and storage logic has deterministic 100% line, function and branch coverage where isolated.
10. Real local PostgreSQL and Edge Function validation prove a verified account with no players has a maximum of six and that private-token lookup returns the same policy.
11. Desktop and Mobile Playwright prove the no-nickname selector state without pre-seeded policy storage, no horizontal overflow, and no page, console or failed-request errors.
12. Existing daily-limit, authentication, account-linking, reservation, league and anti-abuse tests remain green.

## Validation

Substantive code head `827bb8b85e9e7705b7699e4d86aabe5e9fdfdf71` passed:

- Pull Request Quality Pipeline #1211, including the full local Supabase matrix and real `player-context` account-context probe.
- Authentication Quality #392.
- CodeQL Advanced #25.
- Public Asset Audit #884.
- Player Pages and Social Cards #943, including enforced 100% coverage and Desktop/Mobile browser shards.
- Desktop and Mobile evidence showing `Global · 6/6 tiros` with no horizontal overflow, page errors, console errors or failed requests.
- Platform artifact `platform-evidence-30562017008`, digest `sha256:e342e132e6e69fe3bf8d880c990d026a03d44e29e101c94afe6f7d0a106084e2`.

The final head differs only by this task record and remains subject to the same required checks before merge.

## Risks

- **Stale account data:** the browser refreshes the policy through the private account token and uses cached policy only as an immediate fallback.
- **Mixed frontend/backend rollout:** missing policy fields fall back to five; player-specific backend enforcement remains authoritative.
- **Legacy per-nickname bonuses:** player profiles remain authoritative after nickname resolution. The no-nickname account policy intentionally represents account-wide referral and authentication entitlements only.
- **Race after confirmation:** synchronization writes the account token and matching policy atomically, then emits one account update.
- **Credential exposure:** the private token is sent only to the existing same-origin Edge Function boundary and is hashed before database lookup; policy RPCs remain service-role-only.

## Rollback

Revert the frontend and Edge Function changes. If the migration has reached production, add a forward migration that restores the previous `get_game_daily_attempt_state` body and leaves the additive helper functions unused. Do not rewrite an applied migration.

## Delivery

- Branch: `agent/fix-account-daily-attempt-policy`
- Base: current `main`
- Pull request: `#56`
- One normal, non-draft pull request
- No merge, deployment, release or direct production mutation without explicit approval
