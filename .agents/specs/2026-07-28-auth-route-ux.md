# Contextual authentication routes

## Status

In progress. Logout invalidation, centralized route guards, reusable password visibility controls, CI runner isolation and dependency-free visual shard bootstrap are implemented. Stability is reset to zero; three complete green workflow sets are required on this final candidate.

## Request

Replace the overloaded authentication form inside `Mi cuenta` with separate login, registration and email-verification pages. Keep Google and Facebook available on both login and registration. After email registration, show a dedicated verification screen with both OTP-code entry and one-use-link support, an explicit `+1` daily-attempt incentive, and a skip action that goes to `Mi cuenta`.

Protect routes by authentication and local game-account state:

- an already authenticated user must not see login or registration;
- a browser that already owns game progress must be offered linking, not login/registration language;
- an active local game account should manage Google/Facebook linking from `Mi cuenta`;
- email verification controls must only appear for an unconfirmed email-origin account;
- social-origin or social-linked accounts must never show email-verification controls;
- users must be able to create and link new nicknames from `Mi cuenta`.

Follow-up request from 2026-07-29:

- closing the cloud session must immediately clear stale pending-email state and re-render the left account panel without cache or storage deletion;
- every password input must expose one accessible eye button that toggles visibility without duplicating controller logic;
- route access must be declared centrally through an Angular-style guard policy instead of scattered page-specific redirect conditions;
- client guards are navigation and rendering controls only; Supabase Auth, Edge Functions and PostgreSQL remain the authorization boundary.

Centralize decisions and shared UI behavior. Avoid duplicating provider, CAPTCHA, session, route, password, visibility or synchronization logic across pages.

## Evidence

- `account-auth.js` recalculated the experience after sign-out but stale pending-confirmation storage selected `pending-email` again.
- Login, registration and password reset contained five password inputs without a shared visibility control.
- A static multipage application cannot use Angular Router, but it can implement the same `canActivate` model through a declarative route-policy table and one browser guard.
- Frontend route guards are bypassable and cannot replace Edge Function, PostgreSQL or RLS authorization.
- An early CI candidate warmed `account-auth` but later invoked a cold `game-api`; that request reached its 15-second behavioral timeout.
- The auth API candidate now warms only the two functions genuinely used by its journey, concurrently inside the existing 30-second readiness window.
- A GitHub-hosted migrations runner inherited `supabase_db_minuto-106` with port `54322` occupied. The candidate removes stale `supabase_*` containers only on ephemeral GitHub runners before startup.
- A mobile visual shard spent 1 minute 25 seconds installing 134 project packages and another ~47 seconds resolving Playwright, starting tests after the three-minute boundary. Visual shards do not import the project lint/test toolchain.
- The final candidate keeps package-policy validation, exact Node/pnpm/Playwright versions, 16 shards and all evidence, but skips the unrelated project dependency install inside capture shards.
- No behavioral timeout, assertion, browser shard, coverage threshold or test retry was weakened.

## Decisions

1. Keep explicit routes: `login.html`, `registro.html`, `verificar-email.html`, `restablecer-clave.html` and `cuenta.html`.
2. Define one immutable route-policy table with contextual, guest-only, verification and recovery-session policies.
3. Resolve route activation through one pure guard decision and conceal guarded content until that decision completes.
4. Login and registration redirect to `cuenta.html` for cloud or local accounts. Registration with a pending confirmation redirects to verification.
5. Verification requires an eligible unconfirmed email session, pending email or valid verification token. Confirmed/social sessions redirect to `cuenta.html`.
6. Password recovery requires a resolved recovery/auth session; direct unauthenticated access redirects to login.
7. Cloud sign-out clears the persisted pending email and resend deadline before recalculating account mode.
8. Use one idempotent progressive-enhancement password component for every password input.
9. The eye button is type `button`, owns `aria-controls`, `aria-pressed` and an adaptive accessible name, and preserves input value, focus and selection.
10. Keep all backend authorization unchanged.
11. Warm `account-auth` and `game-api` concurrently for the coupled auth API journey, while `auth-browser` continues warming only `account-auth`.
12. Before `supabase start`, remove stale Supabase containers only when `GITHUB_ACTIONS=true`; local developer stacks are never touched by the preflight.
13. Browser capture shards validate the lock/package policy and execute the pinned Playwright launcher directly without installing unrelated ESLint, Knip and Vitest dependencies.
14. Coverage jobs continue using the frozen full project installation; only isolated visual capture shards omit it.

## Acceptance criteria

- [x] Sign-out removes both pending-confirmation values before experience recalculation.
- [x] The left panel immediately becomes guest or local-link and never displays the signed-out email.
- [x] No reload, cache clear or manual storage deletion is needed.
- [x] Every maintained password input receives exactly one shared eye toggle.
- [x] Toggle state, accessible name, value, focus and selection are preserved by mouse/touch/keyboard activation.
- [x] Desktop and Mobile have no horizontal overflow in the changed routes.
- [x] Route policies are immutable and cover guest, local-account, authenticated, verification and recovery contexts.
- [x] Guarded content remains concealed until activation resolves.
- [x] Authenticated/local-account users cannot remain on guest-only routes.
- [x] Direct unauthenticated recovery access redirects to login.
- [x] New pure route/password decisions have 100% line/function/branch coverage.
- [x] Existing backend authorization and real local Auth/API/database journeys remain enabled.
- [x] Stale CI Supabase containers are removed before startup without affecting local execution.
- [x] Visual shards retain 16-way parallelism and avoid project dependency installation.
- [ ] Final candidate workflow execution 1/3 green.
- [ ] Final candidate workflow execution 2/3 green.
- [ ] Final candidate workflow execution 3/3 green.
- [ ] Final-head platform evidence and PR metadata updated.

## Validation history

### Rejected auth API candidate

Head `0ef426ecaccebbf06f89e7bd16a2ffc3812b6e42`:

- Four workflows passed.
- `auth-api` timed out on its first cold `game-api` request after `account-auth` checks passed.
- No retry or timeout increase was accepted.

### Superseded runner-isolated candidate

- Head `c002295afb1cc77e2773160834e7e7f8c85e2a1c` completed all five workflows successfully.
- Head `7454200b39041943c82117ad9d59f5945efa2522` had four green workflows; `mobile-chrome 4/8` was cancelled after project installation consumed 1 minute 25 seconds and the tests started after the three-minute job boundary.
- These sets do not count after changing visual shard bootstrap.

## Risk analysis

- Route loops are prevented by comparing normalized current and target URLs.
- Browser guards are UX controls, never authorization evidence.
- The component retains original password inputs and autocomplete contracts.
- Concurrent warm-up is limited to the two coupled functions used by the auth API journey.
- CI preflight runs only on ephemeral GitHub runners and removes only containers whose names match `supabase_`.
- Visual shards use built-in Node scripts plus the exact Playwright package; the full dependency graph remains installed and tested in coverage/quality jobs.
- Each password input carries an idempotent readiness marker.

## Validation

- 100% Node coverage for route policies, browser guard context and password visibility state.
- Contract tests for shared entry modules, route-shell concealment, password component wiring, auth warm-up, runner preflight ordering and visual shard bootstrap.
- Desktop/Mobile Playwright for stale pending-email logout, all five password fields, keyboard activation, storage cleanup, recovery redirect, page errors and overflow.
- Real local Auth, Edge Function and PostgreSQL journeys.
- Three consecutive complete workflow sets on the final candidate.
- Full platform evidence from the final head.

## Rollback

Revert the route-policy/guard, password component, logout cleanup, auth-api readiness boundary, runner preflight, visual shard bootstrap and related tests as one unit. Do not remove server authorization, restore stale pending state, duplicate page handlers or increase behavioral timeouts.

## Delivery

- Branch: `agent/feat-supabase-auth-account-linking`.
- Pull request: `#39`.
- Stability: `0/3` on the final dependency-light visual candidate.
- No merge, deployment, remote migration or provider-secret change is authorized.
