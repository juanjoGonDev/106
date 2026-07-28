# Contextual authentication routes

## Status

In progress.

## Request

Replace the overloaded authentication form inside `Mi cuenta` with separate login, registration and email-verification pages. Keep Google and Facebook available on both login and registration. After email registration, show a dedicated verification screen with both OTP-code entry and one-use-link support, an explicit `+1` daily-attempt incentive, and a skip action that goes to `Mi cuenta`.

Protect routes by authentication and local game-account state:

- an already authenticated user must not see login or registration;
- a browser that already owns game progress must be offered linking, not login/registration language;
- an active local game account should manage Google/Facebook linking from `Mi cuenta`;
- email verification controls must only appear for an unconfirmed email-origin account;
- social-origin or social-linked accounts must never show email-verification controls;
- users must be able to create and link new nicknames from `Mi cuenta`.

Centralize decisions and shared UI behavior. Avoid duplicating provider, CAPTCHA, session, route, password or synchronization logic across pages.

## Evidence

- `cuenta.html` currently contains social login, email sign-in, email registration, password confirmation, password recovery, verification resend, private-key management and nick management in one card.
- `account-auth.js` currently owns routing-independent authentication, merge handling, CAPTCHA loading, account synchronization and all form modes in one I/O-heavy unit.
- `SupabaseAuthClient` already supports PKCE, password sign-in, signup, resend, recovery, OAuth and session persistence, but has no OTP verification operation.
- Supabase confirmation templates support both `{{ .Token }}` and `{{ .ConfirmationURL }}`. The official verification contract accepts the email plus OTP with type `email`, or a `token_hash` with type `email`.
- A local private account token is only created after a protected game/account action, so its presence is a reliable signal that the browser owns or has imported game-account state.
- `ensure_game_account_player` creates a new player when the requested nickname does not exist, therefore `Mi cuenta` can create a nickname through the existing protected `link-account-player` action without a second persistence path.

## Decisions

1. Add four explicit routes: `login.html`, `registro.html`, `verificar-email.html` and `cuenta.html`.
2. `cuenta.html` remains the only account-management route. It contains no email/password login or registration form.
3. Route and view mode are resolved by one pure state module using: current route, Supabase session, local account token, pending email confirmation and linked providers.
4. Login and registration redirect to `cuenta.html` when a cloud session exists or a local game account is active. Local progress is linked from `Mi cuenta`, never presented as a fresh login/register journey.
5. Registration redirects to `verificar-email.html` after a successful email signup. The verification page accepts the OTP code and supports confirmation-link callbacks. `Saltar por ahora` returns to `cuenta.html` without granting the reward.
6. The confirmation email contains both the OTP code and a custom application link containing `token_hash` and `type=email`; this avoids link-prefetch consumption and supports either interaction.
7. `Mi cuenta` renders one of four modes:
   - guest: links to login and registration;
   - local-link: Google/Facebook linking only;
   - pending-email: verification CTA only;
   - authenticated: identity, linked-provider state, missing-provider linking, sign-out and account data.
8. Provider buttons are shared. Labels are contextual: `Continuar con`, `Crear con`, `Vincular` or `Vinculado`.
9. A session's provider set is derived from `app_metadata.providers`, `app_metadata.provider` and `user.identities`, normalized to Google/Facebook/email.
10. Email verification eligibility requires email origin, no social provider and an unconfirmed email. Any social provider suppresses the verification CTA even when an OAuth provider supplies an unconfirmed email field.
11. Add a nickname-creation form to `Mi cuenta`. It uses the shared nickname policy, the real debounced `player-context` moderation/availability boundary, and the existing protected `link-account-player` write action.
12. Authentication and nickname controllers use shared pure state and service modules. Pages contain markup and thin bootstrap only.
13. Preserve the private-key recovery path and cross-account merge confirmation.
14. Do not add Apple, X, magic-link-only login or anonymous Supabase users.

## Acceptance criteria

1. `login.html` contains email/password login, password recovery, Google and Facebook; no registration fields.
2. `registro.html` contains email/password/confirmation/progressive requirements, Google and Facebook; no login form.
3. Successful email registration navigates to `verificar-email.html` and persists the pending email without exposing whether an existing account was found.
4. Verification accepts the emailed OTP and the emailed custom link, creates a validated session, synchronizes the canonical game account and grants exactly one email reward.
5. Verification explains the one-hour expiry and `+1` daily attempt/logro reward. `Saltar por ahora` reaches `cuenta.html` without verification or reward.
6. Re-send is available on the verification route and on `Mi cuenta` only while an email-origin account remains pending, with the existing cooldown and one-hour expiry.
7. Authenticated users cannot remain on login/register/verification routes; they are redirected to `cuenta.html`.
8. Browsers with an active local account cannot remain on login/register; `Mi cuenta` presents linking language and only Google/Facebook linking controls.
9. Guest `Mi cuenta` presents explicit login/register navigation instead of embedded forms.
10. Authenticated `Mi cuenta` shows linked providers and allows linking each missing social provider independently. Google and Facebook can coexist.
11. Social-origin/social-linked accounts never render email verification or resend UI.
12. Confirmed email-origin accounts never render email verification or resend UI.
13. An unconfirmed email-origin account renders the verification CTA and no unrelated login/register form.
14. `Mi cuenta` can create a valid, available nickname. Invalid, reserved, offensive and occupied names are rejected during the debounced check before the create action is enabled.
15. Nick creation reuses the canonical account token and existing server write boundary; duplicate/race attempts return controlled errors.
16. Every new pure route/state/provider decision module has 100% line/function/branch coverage.
17. Desktop and Mobile Playwright cover guest, local-link, pending-email, authenticated email, authenticated social, dual-provider, route redirects, OTP verification, link verification, skip, resend, nick creation and responsive/accessibility/error health.
18. Real local Supabase integration proves OTP verification, reward idempotency, provider suppression, account sync and nickname persistence.
19. Final-head lint, Knip, security, migrations, Supabase, Playwright and visual-evidence workflows are green.

## Risk analysis

- Route loops: decisions must be pure and redirects must compare normalized current/target routes before navigation.
- Stale local session: session refresh failure must clear the session and resolve the guest/local-link state.
- OAuth account replacement: account synchronization and merge proposal logic remain authoritative after callbacks.
- Email enumeration: signup, resend and recovery messages remain neutral.
- Link prefetch: the email's application link must not directly consume the Supabase confirmation URL; it carries `token_hash` into the explicit verification page.
- Reward duplication: reward remains account-scoped and database-idempotent.
- Social email ambiguity: verification eligibility is provider-based, never based solely on `email_confirmed_at`.
- Nick races: the existing advisory lock/unique constraints remain authoritative; the UI debounce is not authorization.

## Validation

- Node coverage for route/view/provider state and OTP parsing.
- Contract tests for page separation, script loading, form labels, redirect destinations and email template variables.
- Existing Supabase client coverage extended for OTP and token-hash verification.
- Real local Auth/Edge Function/database journey for signup, OTP, link, resend, sync, reward and nick creation.
- Desktop/Mobile Playwright with real application scripts and external-provider interception only.
- Full platform evidence regeneration and PR contract update.

## Rollback

Revert the new route/controller/page commits and restore the prior `cuenta.html` embedded form. Database reward and identity migrations remain compatible. No destructive data migration is introduced.

## Delivery

Continue on `agent/feat-supabase-auth-account-linking` and PR #39. No merge, deployment, remote migration or provider-secret change is authorized.