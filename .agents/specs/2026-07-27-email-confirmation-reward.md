# Email confirmation reward and local Auth UX

## Status

Implementation in progress. Validation and final evidence are pending.

## Request

Fix the account screen reporting Supabase Auth as unavailable on `localhost` even though the production publishable key exists in GitHub. Align the password minimum with the configured Supabase minimum of 10 characters, show each password requirement progressively, require exact password confirmation for signup and reset, and reward a confirmed email account with one additional daily attempt plus an achievement after the one-time confirmation link is consumed.

## Evidence

- GitHub repository variables exist only inside Actions/Pages jobs; they are not automatically exported into a developer shell.
- The committed `public/config.js` intentionally has no production publishable key, so the previous static development server served an unavailable Auth configuration.
- Supabase local exposes its public `API_URL` and `ANON_KEY` through `supabase status -o env`.
- Registration previously required 12 characters in the browser while the product configuration requires 10.
- Signup had no confirmation field and represented all password requirements in a single mutable sentence.
- Email verification was stored privately but did not create an idempotent account-level entitlement or achievement.

## Decisions

1. Never commit the production publishable key merely to support local development.
2. `pnpm dev` derives only the local public URL and anon key from `supabase status -o env`; service-role and provider secrets are never read into browser config.
3. Explicit local environment values override auto-discovery. Production Pages continues to use the GitHub repository variable.
4. Password policy is 10 characters plus lowercase, uppercase, number and symbol. Each requirement has a stable accessible state.
5. Signup and password reset require an exact second entry. Sign-in does not require confirmation.
6. The reward applies only to Supabase identities whose provider is `email` and whose email confirmation timestamp is present. Google and Facebook do not claim the email-link incentive.
7. The reward is an account entitlement with a unique `(account_id, entitlement_code)` key. Replayed callbacks, concurrent tabs and repeated login cannot stack it.
8. Every nickname linked to the canonical account receives the `Cuenta confirmada` achievement. A trigger also grants it to nicknames linked after verification.
9. The entitlement contributes +1 inside the existing account bonus ceiling. The absolute daily maximum remains 10, never 11.
10. Email remains private. Only the public achievement and bonus are exposed; the address is not.

## Acceptance criteria

1. Starting local Supabase and then `pnpm dev` makes Google, Facebook and email controls available without manually copying any production key.
2. When local Supabase is unavailable, the page gives an actionable local message rather than saying the production deployment is disabled.
3. New passwords accept 10 characters and reject fewer than 10.
4. Length, lowercase, uppercase, number and symbol states update independently as the user types.
5. Signup remains disabled until email is valid, all password rules pass and confirmation matches.
6. Sign-in remains possible without filling the confirmation field.
7. Password reset uses the same policy and exact confirmation.
8. A confirmed email identity receives one `verified_email_daily_attempt` entitlement exactly once.
9. The current and future nicknames on that account receive one `email_verified` achievement each, worth 10 points.
10. Unconfirmed email identities, Google identities, Facebook identities and missing identities receive no reward.
11. The new table and RPCs remain inaccessible to `PUBLIC`, `anon` and `authenticated` and executable only by `service_role`.
12. New isolated password decisions retain 100% line/function/branch coverage.
13. Real local Supabase tests cover grant, replay, future nickname linking and ineligible providers.
14. Desktop and Mobile Playwright verify progressive requirements, mismatch handling, signup, login and reset without overflow or page errors.
15. The final PR head has green CI and a new complete platform evidence artifact.

## Validation plan

- `pnpm check`
- `pnpm test:auth-state:coverage`
- `bash scripts/run-supabase-ci.sh`
- `PR_VISUAL_CAPTURE=1 pnpm test:e2e`
- `pnpm preview:platform`
- GitHub Actions quality, browser/evidence, public asset and PR evidence workflows

## Rollback

Revert the development runtime, frontend and Edge Function commits. The additive entitlement table and audit-safe achievement rows may remain dormant. Never rewrite an applied migration; any production correction is a new forward migration.

## Delivery

- Existing branch and normal PR #39 are reused because this is a direct refinement of the authentication feature.
- The daily-limit consumer is implemented independently in PR #40 with an identical additive entitlement schema so either PR can merge first.
- No merge, production migration, deployment or release without explicit authorization.
