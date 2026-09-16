# Code scanning triage and raster number visibility

## Request

Review the active GitHub code-scanning warnings after PR #60 merged, act on verified findings, and fix the production regression where the raster human-check balls no longer show readable numbers. Numbers must exist only inside the rasterized balls; no ordered coordinates, next-ball hints or structured solution data may return to the browser contract.

## Evidence

- PR #60 is merged into `main` at `feed7e294b2b044e1a2fcd16caf565f527ce6f67`.
- `.github/workflows/codeql.yml` still references `actions/checkout@v4` and `github/codeql-action/*@v4` through mutable tags, while the repository's other workflows pin actions to full commit SHAs.
- `createHumanCheckLayout` defaults to `Math.random`. The production caller currently injects `crypto.getRandomValues`, but the shared security owner retains an unsafe default that another caller could accidentally use and that CodeQL can legitimately flag as insecure randomness.
- `drawBall` paints a white 5×7 bitmap digit at scale 4 over a dark center whose radius is only 24% of the ball radius. At the normal 36 px ball radius, the digit is about 20×28 px while the dark background is only about 17 px wide. Most glyph pixels therefore become white-on-white and the number is visually lost.
- Existing raster tests validate PNG signatures, dimensions, determinism and digest, but do not decode pixels or prove that every ball contains a visible high-contrast number.
- The reported production screenshot shows four rendered balls with dark centres but no readable digits.

## Decision

1. Make cryptographically secure randomness the shared default by deriving unit values from `crypto.getRandomValues`; keep dependency injection for deterministic tests.
2. Pin every action used by the CodeQL workflow to a verified full commit SHA and disable persisted checkout credentials.
3. Keep digits entirely inside the server-generated PNG. Render a proportional dark number badge and scale the white bitmap glyph from the ball radius so all four digits remain legible at minimum, default and maximum raster sizes.
4. Add a deterministic PNG decoder in the Node test boundary and assert contrasting dark-badge and light-glyph pixels around every known ball centre. Do not duplicate the production drawing algorithm.
5. Extend the real local Desktop/Mobile Playwright journey to decode the delivered image in-browser and verify visible light glyph pixels within each locally protected solution region. The normal network response and DOM must remain free of coordinates and next-ball information.
6. Treat only verified CodeQL findings as fixed. Do not dismiss alerts or add suppressions merely to make the dashboard green.

## Acceptance

- [ ] Shared human-check layout generation never defaults to `Math.random`.
- [ ] Injected deterministic randomness remains supported and fully covered.
- [ ] CodeQL workflow actions are pinned to full immutable SHAs.
- [ ] CodeQL checkout does not persist credentials.
- [ ] Digits 1, 2, 3 and 4 are visibly rendered inside their corresponding balls at minimum, default and maximum raster dimensions.
- [ ] No number is rendered outside a ball and no ordered solution is added to DOM, ARIA, logs or normal API JSON.
- [ ] The normal human-check response still exposes only raster metadata and image bytes.
- [ ] Node tests decode the PNG and fail if a ball centre lacks both badge and glyph contrast.
- [ ] Desktop and Mobile Playwright verify the visible-number raster while retaining the real browser → Edge Function → PostgreSQL flow.
- [ ] Existing replay, timing, Turnstile, cancellation and concurrency protections remain unchanged and green.
- [ ] Final-head CodeQL, quality, Supabase and visual-evidence workflows are green.

## Checks

- `pnpm test:human-check-raster:coverage`
- `pnpm test`
- `pnpm lint`
- `pnpm knip`
- `pnpm check:syntax`
- real local Supabase `ready-flow` suite
- Desktop and Mobile `@live-ranked-anti-cheat` Playwright journey
- CodeQL Actions and JavaScript/TypeScript analysis
- full `pnpm preview:platform` artifact and PR visual-evidence gate

## Delivery

- Branch: `agent/security-code-scanning-raster-numbers`
- Base: `main`
- One normal, non-draft pull request.
- Do not merge, deploy, publish, dismiss security alerts or run remote migrations without explicit authorization.

## Status

In progress.
