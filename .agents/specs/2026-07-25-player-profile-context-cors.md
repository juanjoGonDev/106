# Player profile context CORS fix

## Request

Remove the visible read-only recovery banner from public player profiles and fix the underlying reason the profile context request falls back to the public endpoint in production.

## Evidence

- Production renders the complete public profile but shows `Perfil cargado en modo lectura` and `Reintentar conexión`.
- The browser console reports that the `player-context` preflight is rejected because request header `x-device-id` is not allowed by `Access-Control-Allow-Headers`.
- `public/player.js` sends `x-device-id` on every `player-context` request.
- `supabase/functions/player-context/index.ts` allows only `content-type` and `x-account-token` and never reads `x-device-id`.
- `public/access.js` already injects the valid `x-account-token` header when an account token exists.

## Decision

1. Remove the unused device identifier and `x-device-id` header from player profile requests instead of widening CORS for data the function does not consume.
2. Preserve account ownership through the existing `public/access.js` fetch boundary and `x-account-token` header.
3. Keep the resilient `game-api/public-profile` fallback, but make it silent and read-only. A successful public fallback must not render a server-update banner or manual retry control.
4. Retain the full-page retry state only when both the context endpoint and public fallback fail.
5. Remove dead recovery markup, styles and JavaScript state.
6. Add browser coverage for the actual request-header contract, normal ownership-aware loading and silent public fallback on desktop and mobile.

## Acceptance

- [x] `player-context` requests do not send `x-device-id`.
- [x] An existing account token is still sent as `x-account-token`.
- [x] A successful `player-context` response does not invoke `game-api/public-profile`.
- [x] The owner-only featured-achievement editor remains available for owned profiles.
- [x] When `player-context` is unavailable, the public profile remains readable through `public-profile` without any recovery banner or `Reintentar conexión` control.
- [x] No recovery-specific markup, styles or dead state remain.
- [x] Syntax, lint, dead-code, unit, security, asset, desktop/mobile Playwright and CI quality checks pass.

## Risks

- Removing the wrong authentication header could hide owner controls. Mitigation: assert `x-account-token` at the intercepted browser request and require the editor to render for an owned response.
- A silent fallback could conceal a total backend outage. Mitigation: the existing full-page error remains when both endpoints fail; only successful read-only fallback is silent.
- Stale browser assets can temporarily retain the old banner after deployment. Mitigation: the source removes the markup entirely and the normal GitHub Pages deployment publishes a new asset revision.

## Tests

- Updated the profile recovery Playwright suite with an owned-context journey that asserts `x-account-token`, rejects `x-device-id`, verifies no public fallback and requires the owner editor.
- Added a silent fallback journey that aborts `player-context`, serves `public-profile`, verifies the profile is usable and asserts the recovery UI is absent.
- Updated Vitest source contracts to reject `x-device-id`, recovery markup and recovery retry wiring while preserving the public fallback and owner-only controls.
- Existing responsive profile, social-card, security, asset and Supabase integration suites remained active.

## Validation

- Pull Request Quality Pipeline `30154318779`: build, syntax, Vitest, ESLint, Knip, dependency and security policy, Supabase integration and Quality Gate succeeded.
- Player Pages and Social Cards `30154318781`: strict frontend coverage and desktop/mobile Playwright journeys succeeded.
- Public Asset Audit `30154318780`: succeeded.
- Pull Request Visual Evidence `30154318773`: succeeded.

## Rollback

Revert the frontend commit. Do not change database data or migrations; this fix is limited to the static profile client and tests.

## Delivery

- Branch: `agent/fix-player-profile-context-cors`.
- Base: `main`.
- Pull request: `#32`.
- No merge or production deployment performed.

## Status

Implementation complete. Pull request open, non-draft and awaiting merge authorization.
