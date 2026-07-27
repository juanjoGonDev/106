# Authentication activation and account reward

## Status

Implementation complete. The authentication branch contains `main` through daily-attempt merge commit `1b7936bdeaa6eabb13a2d0651da9dc37de2c1c31`. Delivery requires the final-head CI, real local Auth journey and evidence checks recorded in PR #39 to remain green.

## Request

Refine the account experience so local development reports missing local Supabase accurately, password policy matches the hosted minimum of 10 characters, signup and reset require exact confirmation, email activation links expire after one hour and can be resent from the account page, and authentication incentives cannot be farmed across providers.

A canonical game account may link Google and Facebook simultaneously. A social-origin account receives one additional daily attempt in total, not one per provider. A game account whose first cloud identity was normal email does not later receive the social reward. A normal-email account receives its one additional daily attempt and the `Cuenta confirmada` achievement only after the one-use activation link is consumed.

After the daily-quota rollout, the reward must feed the authoritative server-day calculation: a fresh account moves from 5 to exactly 6 attempts per day, every linked nick receives the same increase, replay or additional providers keep the total at 6, and all combined bonuses remain capped at 10.

## Evidence

- GitHub repository variables exist only inside Actions/Pages jobs; they are not automatically exported into a developer shell.
- The committed `public/config.js` intentionally has no production publishable key, so the static development server previously served an unavailable Auth configuration.
- Supabase local exposes its public `API_URL` and `ANON_KEY` through `supabase status -o env`.
- Registration previously required 12 characters in the browser while the product configuration requires 10.
- Signup previously had no confirmation field and represented all password requirements in one mutable sentence.
- The original reward recognized only confirmed email identities and did not support a mutually exclusive social-origin reward.
- `game_auth_identities` can map several Supabase user UUIDs to one canonical game account, so Google and Facebook can coexist without weakening the private-key boundary.
- PR #40 made attempts server-day scoped and calculates `maxAttempts` as base 5 plus the account-wide bonus, with a hard ceiling of 10.
- `20260727150600_verified_email_daily_entitlement.sql` consumes both the canonical `auth_identity_daily_attempt` entitlement and the rolling-deployment alias `verified_email_daily_attempt`.

## Decisions

1. Never commit the production publishable key merely to support local development.
2. `pnpm dev` derives only the local public URL and anon key from `supabase status -o env`; service-role and provider secrets never enter browser config.
3. Password policy is 10 characters plus lowercase, uppercase, number and symbol. Signup and reset require an exact second entry; sign-in does not.
4. Confirmation links use Supabase PKCE, are one use and have a configured lifetime of 3,600 seconds.
5. An unconfirmed user can request another signup confirmation from `cuenta.html`; the UI applies a one-minute cooldown and Supabase rate limits remain authoritative.
6. Resend responses are neutral to avoid disclosing whether an email exists.
7. One canonical entitlement, `auth_identity_daily_attempt`, represents the authentication incentive. Its unique account-level key prevents replay, concurrent-tab and multi-provider stacking.
8. The first cloud identity linked to the canonical account fixes `origin_provider`. Later identities cannot change the reward class.
9. Email-origin account: no reward before `email_confirmed_at`; after confirmation, +1 daily attempt and the `Cuenta confirmada` achievement for current and future nicks.
10. Google/Facebook-origin account: +1 daily attempt after first successful link, no email-confirmation achievement. Linking the second social provider is allowed but grants nothing further.
11. An email-origin account never gains the social reward later; a social-origin account never gains a second email reward.
12. The entitlement contributes inside the existing absolute daily ceiling of 10.
13. The authoritative daily state must expose `dailyLimitBase = 5`, `authRewardBonus = 1`, compatibility `emailVerificationBonus = 1`, `bonusAttempts = 1` and `maxAttempts = 6` for an otherwise fresh rewarded account.
14. Reward replay, Google/Facebook linking after email confirmation and clean-browser recovery must not mutate those daily values.
15. Email remains private. Only the public achievement and bonus state may be projected.
16. Hosted Supabase settings are operational configuration: dashboard activation must set confirmation expiry to one hour and paste the maintained email template; the local `config.toml` does not configure hosted Auth by itself.

## Acceptance criteria

1. Starting local Supabase and then `pnpm dev` enables Auth controls without copying a production key.
2. Missing local Supabase produces an actionable local message.
3. New passwords accept 10 characters and reject fewer than 10.
4. Length, lowercase, uppercase, number and symbol update independently.
5. Signup remains disabled until email, password and confirmation are valid; sign-in does not require confirmation.
6. Password reset applies the same password rules and exact confirmation.
7. Signup copy and the email template state that activation expires after one hour and grants +1 plus the achievement.
8. The account page can resend a signup confirmation for a pending email and enforces a visible cooldown.
9. Confirmed email receives one account entitlement and one `email_verified` achievement per current/future nick.
10. Unconfirmed email receives no entitlement.
11. Google-origin or Facebook-origin account receives one shared social entitlement.
12. Google and Facebook identities can both map to the same canonical game account.
13. Linking the second social provider does not create a second entitlement.
14. An email-origin account cannot claim the social incentive after confirmation or while pending.
15. Missing identities receive no reward.
16. A fresh confirmed-email account exposes a total daily limit of exactly 6 for every linked nick.
17. Replaying confirmation or adding Google/Facebook leaves the total daily limit at 6.
18. Authentication plus referral/legacy bonuses never raises the total daily limit above 10.
19. New tables/functions remain inaccessible to `PUBLIC`, `anon` and `authenticated`; only `service_role` can execute them.
20. New isolated decisions retain 100% line/function/branch coverage.
21. Real local Supabase tests cover email grant/replay/future nick, daily-state projection, social first/second provider, email-origin exclusion and pending email.
22. Live Playwright covers real signup, one-hour expiry, resend, confirmation, exact +1 entitlement, exact 5→6 daily total, replay, provider stacking, clean-browser recovery and browser-role denial.
23. Desktop and Mobile Playwright cover progressive password feedback, activation resend, one-hour copy and second-provider availability without overflow or page errors.
24. The final PR head has green CI and a new complete platform evidence artifact.

## Validation

- `pnpm check` includes strict 100% line/function/branch gates for auth state, pending-activation hydration, the Supabase Auth client and the Edge Function boundary.
- Local Supabase integration creates real users/JWTs and exercises email confirmation reward, replay, future nick propagation, pending email, Google then Facebook, email-origin exclusion, merge lifecycle and role isolation.
- `scripts/test-verified-email-reward-local.mjs` now reads `get_game_daily_attempt_state` after each real reward transition and asserts base 5, one auth bonus, total 6, account-wide propagation and no stacking.
- `tests/e2e/account-auth-live.e2e.js` performs the same assertions inside the real browser/Auth journey after email confirmation, replay, Google-first, Facebook linking and email-first social linking.
- The independent daily-quota suite still verifies account-wide propagation, rolling entitlement compatibility and the absolute maximum of 10.
- Browser journeys validate signup confirmation, resend after reload, one-hour copy, cooldown, password matching, both social provider buttons, the one social reward and responsive behavior.
- Database-permission tests enumerate private tables, sequences and privileged functions and probe them using both `anon` and authenticated JWTs.
- The final workflow run IDs, artifact digest and downloadable Desktop/Mobile PNG, WebM, GIF and manifest ZIP are maintained in PR #39 without changing this specification.

## Rollout

1. Merge migrations and Edge Function before Pages.
2. In hosted Supabase, set Auth email confirmation expiry to 3,600 seconds, minimum password length to 10 and email confirmation on.
3. Paste the maintained confirmation subject/template in hosted Auth templates.
4. Keep Brevo custom SMTP, Site URL and redirect allow-list configured.
5. Enable Google and Facebook only after their callback/client settings are complete.
6. Deploy `account-auth`, then Pages.

## Rollback

Revert frontend and Edge Function. Additive identity-origin and entitlement data may remain dormant. Never rewrite an applied migration; any production correction must be a new forward migration.

## Delivery

- Existing branch and normal PR #39 are reused because these are direct authentication refinements.
- The branch contains the merged daily-attempt implementation from `main`; no parallel compatibility branch or second PR is used.
- No merge, production migration, deployment or release without explicit authorization.
