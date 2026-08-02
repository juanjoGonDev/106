# Historical football styling, award reset countdown and daily-limit consistency

## Request

- Restore the numbered-football interaction used before PR #60 while retaining the server-rendered raster boundary.
- Preserve the historical colour progression: neutral white, current target with a gold ring/glow, and server-confirmed selections in green.
- Restore the heavier, clearer numeral shapes from the historical browser canvas.
- Show a live countdown to the daily reset of the provisional global awards.
- Fix contradictory daily-limit states and neutral global-score rendering.

## Evidence

- PR #62 restored server-confirmed progressive responses but retained the green pitch and matrix digits introduced by PR #60/#61.
- The first PR #63 implementation restored only the pitch, white neutral fill and green completed fill. It omitted the historical gold active state and replaced the browser glyphs with manual vector strokes. That was not a faithful restoration.
- The authoritative pre-PR-60 renderer is `public/human-check.js` at commit `016bb11c93065a796cf4985c617e0a32438ec260`.
- That renderer uses:
  - pitch gradient `#620019 → #10121a → #12305f`;
  - translucent `#ffffff22` field lines;
  - neutral fill `#f7f8fb`;
  - active outline `#f4c95d` with `#f4c95dcc` glow and 24 px blur;
  - completed fill `#54d18b`;
  - dark outline/pentagon `#11151d`;
  - `900`-weight `system-ui` numerals.
- The historical active highlight does not expose coordinates or structured solution data: it remains inside the server-generated PNG. It does make the next numeral easier to recognise visually, but the ascending numeral order is already explicit to the player. The stronger boundaries remain server-side geometry, atomic per-click validation, expiry and one-use proof consumption.
- The exact browser-rendered historical PNG was reconstructed from that commit with deterministic coordinates and device pixel ratio 1. The server implementation uses baked alpha masks captured from the same `900 22px system-ui` glyph rendering, avoiding runtime font dependencies in Supabase.
- The historical completed numeral used a dark colour over the dark pentagon. This made the numeral disappear after confirmation. The restored implementation keeps the historical shape but uses white in every state for legibility.
- `normalizeDailyAttemptProfile()` previously trusted a redundant `attemptsLeft` value independently from used, reserved and maximum counts.
- The awards response previously omitted the canonical Madrid reset instant.
- The home scoreboard represented an empty 0–0 total as an invented 50% split.

## Decision

1. Keep challenge coordinates and hit geometry server-side. Public responses continue to expose only PNG data, dimensions, digest and lifecycle state.
2. Restore the historical pitch, neutral football, dark pentagon and diffuse shadow.
3. Restore the gold active ring/glow and advance it only after the previous click is confirmed by the server.
4. Restore the historical numeral silhouettes through embedded alpha masks derived from the old browser canvas; do not load or distribute a font file.
5. Keep completed footballs green and all numerals white for readable confirmation.
6. Derive `attemptsLeft` only from `maxAttempts - attemptsUsed - attemptsReserved`.
7. Expose `resetAt` from the canonical Madrid server-day functions and reuse the shared countdown formatter.
8. Clamp an expired countdown to `00:00:00`, stop its interval and perform one authoritative refresh.
9. Normalize team scores to finite non-negative values and render `Sin puntos` when both are zero.

## Scope

- Shared human-check raster renderer and strict 100% coverage tests.
- Daily-attempt normalization and regression tests.
- Awards SQL contract, countdown lifecycle and responsive home UI.
- Empty and malformed global-score rendering.
- Local Supabase, desktop/mobile Playwright and platform evidence.

## Risks

- **Automation assistance:** a gold next-target cue is visually easier to detect. It is accepted because the numeral order is already visible and no coordinates or structured solution are returned. Server validation remains authoritative.
- **Visual drift:** tests assert exact RGBA state constants, gold glow movement, green confirmation and readable numeral pixel coverage.
- **Font drift:** runtime fonts are prohibited from owning the contract. The baked masks are the canonical numeral shapes.
- **Countdown drift:** the client consumes the server reset instant rather than rebuilding Madrid midnight.
- **Reset race:** only one refresh may run after expiry.
- **Rolling deployment:** missing `resetAt` degrades to an unavailable countdown.

## Acceptance

- [x] Coordinates and challenge geometry remain absent from public responses.
- [x] The pitch uses the historical burgundy/dark/blue gradient and field lines.
- [x] The current football has the historical gold outline and glow.
- [x] Each confirmed football changes to green before the gold cue advances.
- [x] Numerals 1–4 use the heavier historical browser silhouettes and remain readable in every state.
- [x] Raster output is deterministic for identical layout and progress.
- [x] Minimum, default and maximum output dimensions are covered.
- [x] Human-check raster tests pass with 100% lines, branches and functions.
- [x] Fresh daily quota cannot render as exhausted because of a stale redundant field.
- [x] Awards countdown uses the server-supplied Madrid reset instant and never becomes negative.
- [x] Empty 0–0 global score renders `Sin puntos`.
- [ ] Final-head full CI and fresh desktop/mobile platform evidence pass.

## Checks

- `node --check supabase/functions/_shared/human-check-raster.js`
- `pnpm test:human-check-raster:coverage`
- `pnpm check`
- `pnpm test:supabase`
- `pnpm test:e2e`
- Pull-request CI and platform evidence workflows

Local isolated validation for the corrected renderer:

- syntax: passed;
- deterministic PNG generation for progress 0–4: passed;
- human-check raster tests: 4 passed;
- coverage: 100% lines, 100% branches, 100% functions.

## Rollback

- Revert the renderer and test commits normally.
- If the awards SQL migration has reached production, do not rewrite or delete it; use a forward migration for any contract change.

## Delivery

- Branch: `agent/fix-football-awards-reset`
- Base: `main`
- Pull request: `#63`
- Merge/deploy/release: not authorized

## Status

The historical football states and numeral silhouettes are implemented and locally validated. Final-head CI and regenerated platform evidence are pending.
