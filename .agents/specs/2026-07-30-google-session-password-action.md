# Hide password change for Google-authenticated sessions

## Status

Implemented on `agent/fix-google-password-action`; final-head CI and visual-evidence validation are pending on PR #54. No merge or deployment is authorized.

## Request

A user authenticated through Google must not see or enter the authenticated password-change flow, even when the same Supabase account also has an email identity. The form requires a current password that a Google-authenticated session did not prove.

## Evidence

- The account UI used `identitySupportsPassword(identity)` to check whether any linked provider was `email`.
- Supabase `app_metadata.provider` records the first provider used to create the account, while `app_metadata.providers` records all available login providers; neither reliably identifies how the current session authenticated.
- The access-token `amr` claim records authentication methods such as `password`, `oauth`, `recovery` and `token_refresh`.
- Therefore an account originally created with email and currently authenticated through Google could expose `Cambiar contraseña` incorrectly.

## Decision

1. Derive the current session authentication methods from the Supabase access-token `amr` claim.
2. Permit authenticated password change only when the current session explicitly contains the `password` authentication method.
3. Fail closed when the token or `amr` claim is missing or malformed.
4. Keep recovery-link password reset independent: a valid recovery callback may reset the password without a current-password field.
5. Apply the same decision to both the account button and direct `restablecer-clave.html?mode=change` access.
6. Treat JWT parsing as UI capability detection only; no authorization or server trust is delegated to the decoded payload.

## Implementation

- `public/auth-experience-state.js` decodes the JWT payload defensively, normalizes unique `amr` methods and exposes them on the derived authenticated identity.
- `identitySupportsPassword` now requires an explicit `password` authentication method instead of inferring capability from linked providers.
- Existing account rendering and direct password-page guards reuse the same centralized decision without duplicated provider logic.
- Node tests cover malformed JWTs, missing claims, normalization, duplicates, password sessions, OAuth sessions and the linked email/Google regression.
- Desktop/Mobile Playwright coverage models a Google OAuth session whose `app_metadata.provider` remains `email` and verifies both the hidden action and guarded direct route.

## Acceptance criteria

1. A password-authenticated email session shows `Cambiar contraseña` and can enter change mode.
2. A Google OAuth session hides `Cambiar contraseña`.
3. A Google OAuth session linked to an email identity still hides the action, including when `app_metadata.provider` remains `email`.
4. Direct change-mode navigation from either Google scenario redirects to Mi cuenta.
5. Recovery mode continues to work without requiring the current password.
6. Missing, malformed or unsupported `amr` data does not expose password change.
7. JWT method parsing and capability decisions retain 100% line, function and branch coverage.
8. Desktop and Mobile Playwright regression coverage proves the linked Google/email scenario and responsive account state.

## Validation

- Local syntax and focused behavior smoke check completed for JWT method parsing and password capability decisions.
- `pnpm test:auth-experience:coverage`
- `pnpm test -- tests/auth-route-and-password-components.test.js`
- Authentication Quality workflow
- Pull Request Quality Pipeline
- Player Pages and Social Cards Desktop/Mobile journeys
- Pull Request Visual Evidence with final-head account evidence

## Risks and rollback

- Older or non-Supabase tokens without `amr` hide password change rather than guessing from account metadata. This is the safer UX because the current-password requirement cannot be established.
- Recovery remains available from login, so users are not locked out of password management.
- Rollback is a normal revert; there are no schema, secret or hosted configuration changes.

## Delivery

- Branch: `agent/fix-google-password-action`
- Base: `main` at `12e5946214802a38ce57d65c5a81a501c6cddd07`
- Pull request: #54, normal and non-draft
- No merge, deployment or remote mutation
