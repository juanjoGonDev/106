# Mobile touch recovery and social preview

## Request

- Fix the production mobile failure that rejects a real touch stop.
- Add regression coverage for a complete touch attempt.
- Replace the current social preview with a legible, compelling 1200×630 image.

## Evidence

- `finish_game_attempt_pointer_only` required `userActivation = true` for every pointer type.
- Mobile browsers and in-app webviews may report `navigator.userActivation.isActive` as false or unavailable during a trusted touch pointer event.
- The public error maps that rejection to `invalid_pointer_finish`, matching the reported mobile modal.
- The previous raster preview had weak hierarchy and poor readability at share-card size.

## Decision

- Preserve strict pointer-only input, the server-issued nonce, visual proof, trusted pointer flag, device/IP binding and automation telemetry.
- Require user activation for mouse input, but do not make that browser-specific API a hard requirement for trusted `touch` or `pen` input.
- Preserve the activation value observed by the browser in `userActivationObserved`, then normalize the legacy ranking signal only after the stricter mobile wrapper has accepted the trusted touch path.
- Add a local Supabase integration journey using `pointerType: touch` and `userActivation: false`.
- Generate the social PNG deterministically with Node built-ins and publish byte-identical copies at every path used by the supported Pages modes.
- Use a new Open Graph filename so social platforms do not reuse the previous image URL.

## Acceptance

- A complete touch attempt with a trusted pointer event and valid one-time visual proof returns HTTP 201, is persisted and remains verified.
- Mouse input without user activation remains rejected.
- Touch/pen input reporting browser automation remains rejected.
- Keyboard completion remains unavailable.
- The social preview is a valid 1200×630 PNG, is byte-identical at all published paths and remains readable at small preview sizes.
- Build, Vitest, ESLint, Knip, security checks and local Supabase integration pass.

## Validation

- GitHub Actions run `29910816418` completed successfully on commit `cdcbee972840a3d838b2caa591299d4ddf3da00f`.
- The local Supabase job rebuilt PostgreSQL from all migrations, served the Edge Function and completed the existing global/miniliga journeys.
- The dedicated mobile journey completed the numbered-ball proof with touch input and persisted a verified 10.750-second attempt while `userActivation` was false.
- Vitest rendered the PNG using only Node and validated its signature, 1200×630 dimensions, Open Graph URL and byte identity across publishing paths.

## Rollback

- Revert the pull request.
- Do not edit an applied migration; add a corrective migration if production rollback is required.

## Delivery

- Branch: `agent/fix-mobile-touch-and-social-preview`.
- Normal PR to `main`.
- No merge or production deployment without explicit approval.

## Status

Ready for review. CI is green; production remains unchanged until merge and deployment.
