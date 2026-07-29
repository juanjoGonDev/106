# Contextual authentication routes

## Status

In progress. Follow-up UX hardening is being implemented for immediate sign-out state invalidation, centralized route guards and reusable password visibility controls.

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

- `cuenta.html` currently contains contextual cloud-account panels, private-key management and nick management.
- `account-auth.js` signs out the Supabase session and recalculates the experience, but leaves `minuto106:pending-email-confirmation-v1` and its resend timestamp in local storage. The stale values select `pending-email` again after logout.
- `login.html`, `registro.html` and `restablecer-clave.html` contain five password inputs without a shared visibility control.
- `resolveAuthExperience` already centralizes most redirect decisions, but route policy is implicit in condition ordering and controllers still compose experience plus redirect separately.
- A static multipage application cannot use Angular Router, but it can expose the same `canActivate` model through a declarative route-policy table and one guard function executed before page initialization.
- Frontend route guards cannot protect data because browser code can be bypassed. Server authorization and row/function permissions remain mandatory.
- `SupabaseAuthClient` supports PKCE, password sign-in, signup, resend, recovery, OAuth and session persistence.
- A local private account token is only created after a protected game/account action, so its presence is a reliable signal that the browser owns or has imported game-account state.

## Decisions

1. Keep explicit routes: `login.html`, `registro.html`, `verificar-email.html`, `restablecer-clave.html` and `cuenta.html`.
2. `cuenta.html` remains the only account-management route. It contains no email/password login or registration form.
3. Define one immutable route-policy table with contextual/public, guest-only, verification and recovery-session policies.
4. Resolve route activation through one pure guard decision used by the browser guard. Page controllers consume the guard result instead of repeating redirect composition.
5. Hide auth-route content until its guard resolves, preventing unauthorized or incompatible form flashes before navigation.
6. Login and registration redirect to `cuenta.html` when a cloud session exists or a local game account is active. Registration with a pending confirmation redirects to `verificar-email.html`.
7. Verification requires an unconfirmed email session, a pending email or a valid verification token. Confirmed/social sessions redirect to `cuenta.html`; missing context redirects to registration.
8. Password recovery accepts a valid recovery callback or an existing recovery/auth session; an unauthenticated direct visit redirects to login.
9. `Mi cuenta` renders one of four modes: guest, local-link, pending-email or authenticated.
10. Cloud sign-out clears the persisted pending-confirmation email and resend deadline before recalculating the account experience.
11. Add one progressive-enhancement password visibility component loaded from the shared layout. It wraps every password input once and creates a type `button` eye control with `aria-controls`, `aria-pressed`, an adaptive accessible label and preserved input focus/selection.
12. Keep the icon and component styles shared. Do not add separate click handlers to login, registration or recovery controllers.
13. Provider buttons remain shared. Labels are contextual: `Continuar con`, `Crear con`, `Vincular` or `Vinculado`.
14. Email verification eligibility requires email origin, no social provider and an unconfirmed email. Any social provider suppresses the verification CTA.
15. Preserve the private-key recovery path, cross-account merge confirmation and existing server-side authorization.
16. Do not add Apple, X, magic-link-only login or anonymous Supabase users.

## Acceptance criteria

1. Closing the cloud session removes both pending-confirmation storage values before the account experience is recalculated.
2. After logout, the left panel becomes `guest` when no local account exists or `local-link` when a local account remains; it never displays the signed-out email.
3. The logout behavior is correct immediately without reload, cache clearing or manual local-storage deletion.
4. Every maintained password input receives exactly one eye toggle and no page owns duplicate visibility logic.
5. The toggle changes `password` to `text` and back, updates `aria-pressed` and its accessible name, preserves the value, input focus and selection, and works by mouse, touch and keyboard.
6. Login, registration and password-reset layouts remain responsive with no horizontal overflow in Desktop and Mobile.
7. Route policies are immutable, explicit and covered for guest-only, local-account, authenticated, pending-verification, verified/social and recovery-context states.
8. Auth pages remain visually hidden only while the guard is unresolved and are revealed on allowed/config-unavailable paths.
9. Authenticated users cannot remain on login/register/verification routes.
10. Browsers with an active local account cannot remain on login/register; `Mi cuenta` presents linking language.
11. A direct unauthenticated visit to the recovery page cannot expose the password form as an active route.
12. Client route guards are not used as authorization evidence; existing API, database and RLS/function checks remain unchanged.
13. New pure route/password-state decisions have 100% line/function/branch coverage.
14. Desktop and Mobile Playwright reproduce cloud logout with stale pending state, verify all password toggles, keyboard behavior, final UI, storage cleanup, route redirects, page errors and responsive overflow.
15. Final-head lint, Knip, unit/coverage, security, Playwright, visual-evidence and quality workflows are green.

## Risk analysis

- Route loops: guard redirects compare normalized current and target URLs before navigation.
- Content flash: guarded shells stay hidden until the centralized guard allows the route.
- Stale local session: session refresh failure clears the session and resolves the guest/local-link state.
- Stale confirmation state: logout explicitly clears both confirmation keys; verification completion already uses the same shared clearing function.
- Recovery callbacks: the guard must recognize PKCE query callbacks and implicit token hashes without logging or persisting URL secrets longer than required.
- Password-manager compatibility: the component keeps the original input, name/id, autocomplete and value; it only wraps and toggles `type`.
- Accessibility: the button must be keyboard reachable, have a changing accessible name and not rely on the icon alone.
- Security misconception: client guards are bypassable and never replace backend authorization.
- Duplicate enhancement: each input carries an idempotent readiness marker.

## Validation

- Node coverage for route policies, guard decisions, browser context and password visibility state.
- Contract tests for shared component loading, route-shell hiding and package syntax/asset ownership.
- Desktop/Mobile Playwright for stale pending-email logout, guest/local-link outcomes, password toggling, keyboard operation and responsive health.
- Existing real local Auth/Edge Function/database journeys remain unchanged and must pass.
- Full platform evidence regenerated from the final head; changed-area Desktop/Mobile/GIF evidence linked in PR #39.

## Rollback

Revert the route-policy/guard, password component, logout cleanup and related tests as one follow-up unit. Do not remove server authorization, restore stale pending state, duplicate visibility handlers in page controllers or expose guarded shells before resolution.

## Delivery

Continue on `agent/feat-supabase-auth-account-linking` and PR #39. No merge, deployment, remote migration or provider-secret change is authorized.