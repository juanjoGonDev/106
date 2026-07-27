# Supabase authentication and account linking

## Status

Implementation complete. Final delivery remains gated by the required pull-request checks and final-head evidence artifact.

## Request

Add optional Supabase authentication to Minuto 106 with Google, Facebook and email/password while preserving the existing anonymous private-key account. A signed-in identity must recover the same game account on another device. If a Supabase identity and the current browser key belong to different game accounts, the system must compute the competitive consequences before mutation, show an explicit confirmation dialog listing every trophy, achievement or advantage that will be removed, and merge only after the user confirms. Store the verified authentication email privately for future transactional email features.

The CI must continuously prove that `anon` and `authenticated` cannot access server-owned game data or privileged RPCs directly. New isolated authentication, validation, merge-impact and controller decisions require 100% line, function and branch coverage.

## Evidence

- The current browser creates one random 64-character account token and sends it as `x-account-token` for protected game actions.
- PostgreSQL stores only the account-token hash in `game_accounts` and maps every nickname to one game account through `game_account_players`.
- Server-owned game tables have RLS enabled, direct privileges revoked from `anon` and `authenticated`, and service-role-only access.
- The previous database-permission integration check validated only one trigger function and did not enforce the complete role boundary.
- League membership prevents the same account or device from occupying multiple places. Progression includes league podium/participation, duel-win and referral achievements, so merging accounts can invalidate previously independent identities.
- GitHub Pages already generates public runtime configuration and the repository variable `SUPABASE_PUBLISHABLE_KEY` is available.

## Decisions

1. The game account remains the canonical aggregate. Supabase Auth is an optional recovery credential, not a replacement for the anonymous account key.
2. Existing private keys remain valid after authentication. A signed-in identity may receive a new private key on a new device; only hashes are persisted.
3. A dedicated `account-auth` Edge Function validates the Supabase user JWT and performs all identity/link/merge operations through service-role-only database functions. Game APIs remain token-based and unchanged at their public boundary.
4. The browser uses PKCE directly against the official Supabase Auth HTTP contract for OAuth, email/password sessions and token refresh. Provider secrets and SMTP credentials remain exclusively in Supabase.
5. Email is contact data, never an authorization key. Authorization uses the immutable Supabase `auth.users.id` obtained from a verified JWT.
6. Merge preparation is read-only and creates a short-lived proposal containing a deterministic impact fingerprint. Confirmation re-locks both accounts, recomputes the impact in the same transaction and rejects stale proposals.
7. Competitive invalidation is auditable. The merge event stores the complete removed-item snapshot. Invalid leagues, self-duels and self-referrals are marked, derived trophies/achievements are removed, and referral bonus attempts are corrected without deleting attempts or player history.
8. Any league containing both accounts is no longer identity-eligible after the merge, even when three other distinct accounts remain, because one account would occupy multiple participant slots.
9. No direct table policy is added merely to silence `RLS Enabled No Policy`. CI instead enforces deny-by-default plus explicit service-role-only boundaries.
10. The account UI provides accessible Google, Facebook, email registration/login, password recovery, session status, sign-out and a dedicated merge-impact dialog. Unsupported providers are rejected at browser, Edge Function and database boundaries.

## Scope

### Database

- Add multiple hashed credentials per game account and backfill every existing token hash.
- Add private Supabase-auth identity mapping and verified contact-email fields.
- Add merge proposal/event audit tables and canonical merged-account resolution.
- Add identity-invalidated metadata to leagues, duels and referrals.
- Add service-role-only prepare/confirm/session RPCs.
- Reconcile league trophies, podium/participation achievements, duel-win achievements, referral achievements and referral bonus attempts.
- Preserve old RPC signatures and existing private keys during rolling deployment.

### Edge Functions

- Add `account-auth` with strict origin, method, body-size, JWT and action validation.
- Accept `Authorization: Bearer <user JWT>`, `apikey`, `x-account-token` and `x-device-id` in CORS.
- Return raw account keys only when newly issued, never stored or logged.
- Provide session, prepare-link, confirm-merge and cancel-merge contracts with neutral errors.

### Frontend

- Extend generated runtime config with Supabase URL, publishable key and account-auth endpoint.
- Add Google and Facebook PKCE sign-in.
- Add email registration, confirmed email/password login, password recovery and reset.
- Synchronize a successful Supabase session to the local game-account key.
- Present exact merge losses before confirmation.
- Keep anonymous play and manual private-key recovery fully functional.

### CI and tests

- Generalize the database permission test to every server-owned table, sequence and privileged function.
- Assert `anon` and `authenticated` cannot select, insert, update, delete or execute private account/game operations.
- Add real local Auth users/JWTs and exercise `account-auth`, linking, recovery, stale proposal rejection and transactional merge consequences.
- Add deterministic unit/contract tests and 100% line/function/branch coverage for new isolated authentication and merge-impact modules.
- Add complete Desktop and Mobile Playwright journeys for anonymous, authenticated, email reset and merge-confirmation states.
- Update the full-platform visual evidence inventory with the new screens and interaction.

## Acceptance criteria

1. Anonymous users can continue playing without creating a Supabase account.
2. Google, Facebook and confirmed email/password sessions can link to the current anonymous account without losing progress.
3. Signing in on a clean browser creates a new private credential for the previously linked game account and restores all nicknames.
4. Existing manual private-key import/export remains valid after OAuth/email linking.
5. A cross-account login never merges automatically when competitive consequences exist.
6. The merge dialog lists every trophy, achievement, bonus-attempt correction and invalidated competition before confirmation.
7. Cancel leaves both accounts and all competitive data unchanged.
8. Confirm is atomic, idempotent, concurrency-safe and rejects expired or stale proposals.
9. After confirmation, both old account keys and the Supabase identity resolve to the canonical merged account.
10. The verified email is stored privately and never appears in public profiles, rankings, logs, analytics or public API payloads.
11. Direct Data API access by `anon` or `authenticated` to server-owned tables/functions fails in local integration and CI.
12. Invalid, expired, missing-project and wrong-project JWTs are rejected.
13. Email/password flows do not disclose whether an email is registered.
14. New isolated logic has 100% line, function and branch coverage; existing thresholds do not decrease.
15. Desktop and Mobile browser journeys have no unexpected console errors, failed requests or horizontal overflow.
16. The final PR head publishes the complete platform evidence ZIP and all required checks are green.

## Risk analysis

- **Credential exposure:** only publishable keys and user JWTs reach the browser. Service-role, provider and SMTP secrets remain server-side.
- **Account takeover:** a JWT alone can access only its mapped account; account merge requires a valid current account credential and explicit confirmation when losses exist.
- **TOCTOU:** proposal confirmation recomputes the impact under advisory locks and compares a deterministic fingerprint.
- **Concurrent tabs:** account/auth locks and unique constraints make repeated link/confirm operations idempotent.
- **Rolling deployment:** existing account-token lookups continue through the original `game_accounts.token_hash` while credential backfill and new lookup functions coexist.
- **Email privacy:** normalized email is private, nullable and sourced only from the validated Supabase user record.
- **Competition integrity:** merges invalidate any competition that previously relied on both accounts as independent identities and reconcile derived rewards.
- **SMTP abuse:** signup/recovery use Supabase CAPTCHA tokens and Auth rate limits; messages remain neutral.
- **Third-party OAuth:** browser tests replace external Google/Facebook redirects deterministically; the real repository-owned callback/session/link boundary is exercised locally.
- **Fingerprint availability:** the merge functions explicitly include the `extensions` schema in their restricted search path so `pgcrypto.digest` remains available without broadening caller privileges.

## Test matrix

- Runtime config: valid/missing/malformed publishable key, derived endpoints and production/local URLs.
- Auth decisions: provider availability, password policy, neutral error mapping, session status and impact normalization.
- Permission contract: table/sequence/function privileges for `anon`, `authenticated` and `service_role`.
- Auth API: CORS, unsupported methods/actions, oversized/malformed bodies, no bearer, invalid bearer, wrong-project JWT, confirmed/unconfirmed email and provider metadata.
- Link: new auth + current account, new auth + no account, existing auth + clean device, existing auth + same account and repeated execution.
- Merge: no-impact automatic unification, league trophy/podium, participation threshold, self-duel threshold, self-referral threshold and bonus correction.
- Merge lifecycle: cancel/no mutation, expiry, stale fingerprint, duplicate confirmation and concurrent confirmation.
- Compatibility: original private key, legacy nickname key, old account RPCs, empty setup, incremental upgrade and repeated function replacement.
- Browser: Google/Facebook initiation, email signup/login/recovery, callback session, clean-device recovery, merge list/cancel/confirm, keyboard/focus/reduced-motion/responsive overflow.

## Validation results

- `pnpm check` covers syntax, ESLint, Knip, unit/security suites and every strict 100% coverage gate for the new isolated authentication modules.
- The local Supabase CI journey applies the real migrations, starts the real Auth/API/Edge Function stack and validates account creation, linking, clean-device recovery, merge impact, cancellation, expiry, stale data, duplicate confirmation and concurrent confirmation.
- The permission audit enumerates every server-owned `game_*` table, sequence and privileged function, then performs real PostgREST probes using both the anonymous key and an authenticated user JWT.
- Desktop and Mobile Playwright journeys validate OAuth initiation, neutral email flows, account synchronization, merge confirmation/cancellation, password reset, responsive overflow and unexpected browser errors.
- The platform evidence workflow generates complete PNG, WebM and derived GIF evidence plus a SHA-256 manifest from the final pull-request head.

## Rollout and rollback

- Additive forward migrations only; do not rewrite applied migrations.
- Deploy database/functions before Pages. The frontend treats unavailable auth configuration as a non-blocking anonymous-account state.
- Roll back frontend and Edge Function by revert if required. Persisted identity/credential/audit tables may remain unused.
- Any database correction after production deployment must be a new forward migration. Do not delete merge audit history.

## Delivery

- Exactly one branch: `agent/feat-supabase-auth-account-linking`.
- Exactly one normal, non-draft PR: `#39`.
- Conventional Commit history.
- Final-head quality, Supabase, security, coverage, browser and evidence checks are mandatory before merge.
- No merge, production migration, deployment or release without explicit authorization.
