# Mobile touch recovery and social preview

## Request

- Fix the production mobile failure that rejects a real touch stop.
- Add regression coverage for a complete touch attempt.
- Replace the current social preview with a legible, compelling 1200×630 image.

## Evidence

- `finish_game_attempt_pointer_only` currently requires `userActivation = true` for every pointer type.
- Mobile browsers and in-app webviews may report `navigator.userActivation.isActive` as false or unavailable during a trusted touch pointer event.
- The public error maps that rejection to `invalid_pointer_finish`, matching the reported mobile modal.
- The current raster preview is visibly degraded and does not provide a clear hierarchy at share-card size.

## Decision

- Preserve strict pointer-only input, the server-issued nonce, visual proof, trusted pointer flag, device/IP binding and automation telemetry.
- Require user activation for mouse input, but do not make that browser-specific API a hard requirement for trusted `touch` or `pen` input.
- Record whether the User Activation API was available for telemetry.
- Cache-bust the gameplay scripts so mobile clients cannot keep the incompatible signal contract.
- Add a local Supabase integration journey using `pointerType: touch` and `userActivation: false`.
- Publish a new repository-owned PNG preview at every path used by the supported Pages modes.

## Acceptance

- A complete touch attempt with a trusted pointer event and valid one-time visual proof returns HTTP 201 and is persisted.
- Mouse input without user activation remains rejected.
- Keyboard completion remains unavailable.
- The browser signal includes `userActivationSupported`.
- Gameplay scripts use a new immutable cache version.
- The social preview is a valid 1200×630 PNG, is byte-identical at all published paths and remains readable at small preview sizes.
- Build, Vitest, ESLint, Knip, security checks and local Supabase integration pass.

## Rollback

- Revert the pull request.
- Do not edit an applied migration; add a corrective migration if production rollback is required.

## Delivery

- Branch: `agent/fix-mobile-touch-and-social-preview`.
- Normal PR to `main`.
- No merge or production deployment without explicit approval.

## Status

In progress.
