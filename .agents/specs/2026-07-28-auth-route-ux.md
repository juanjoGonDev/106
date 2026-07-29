# Contextual authentication routes

## Status

In progress. Logout invalidation, centralized route guards and reusable password visibility controls are implemented. Two complete final-candidate workflow sets are green; one further consecutive set is required.

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
- The first CI candidate exposed that `auth-api` warmed `account-auth` but later invoked a cold `game-api`; that request reached its 15-second behavioral timeout.
- The final candidate warms only the two functions genuinely used by `auth-api`, concurrently inside the existing bounded 30-second readiness window. No behavioral timeout or retry was increased.

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
- [x] Final candidate workflow execution 1/3 green.
- [x] Final candidate workflow execution 2/3 green.
- [ ] Final candidate workflow execution 3/3 green.
- [ ] Final-head platform evidence and PR metadata updated.

## Validation history

### Rejected candidate

Head `0ef426ecaccebbf06f89e7bd16a2ffc3812b6e42`:

- Authentication Quality, browser shards, asset audit and visual contract passed.
- `auth-api` timed out on its first cold `game-api` request after its `account-auth` checks had passed.
- No retry or timeout increase was accepted as a fix.

### Final candidate execution 1/3

Head `fe24aee129b3193eb161b0c937316252733bdf46`:

- Pull Request Quality Pipeline `30444244934`: success.
- Player Pages and Social Cards `30444244890`: success.
- Authentication Quality `30444244898`: success.
- Public Asset Audit `30444244904`: success.
- Pull Request Visual Evidence `30444244905`: success.

### Final candidate execution 2/3

Head `352f21c22661e110aca49a64994ddf8ed71ea8d3`:

- Pull Request Quality Pipeline `30444636252`: success.
- Player Pages and Social Cards `30444636268`: success.
- Authentication Quality `30444636266`: success.
- Public Asset Audit `30444636251`: success.
- Pull Request Visual Evidence `30444636250`: success.

## Risk analysis

- Route loops are prevented by comparing normalized current and target URLs.
- Browser guards are UX controls, never authorization evidence.
- The component retains original password inputs and autocomplete contracts.
- Concurrent warm-up is limited to the two coupled functions used by the auth API integration journey and remains bounded to the existing readiness window.
- Each password input carries an idempotent readiness marker.

## Validation

- 100% Node coverage for route policies, browser guard context and password visibility state.
- Contract tests for shared entry modules, route-shell concealment and password component wiring.
- Desktop/Mobile Playwright for stale pending-email logout, all five password fields, keyboard activation, storage cleanup, recovery redirect, page errors and overflow.
- Real local Auth, Edge Function and PostgreSQL journeys.
- Three consecutive complete workflow sets on the final functional tree.
- Full platform evidence from the final head.

## Rollback

Revert the route-policy/guard, password component, logout cleanup, auth-api readiness boundary and related tests as one follow-up unit. Do not remove server authorization, restore stale pending state, duplicate page handlers or increase behavioral timeouts.

## Delivery

- Branch: `agent/feat-supabase-auth-account-linking`.
- Pull request: `#39`.
- Stability: `2/3` complete green workflow sets.
- No merge, deployment, remote migration or provider-secret change is authorized.
