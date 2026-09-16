# Historical football styling, award reset countdown and daily-limit consistency

## Request

- Restore the numbered-football interaction used before PR #60 while retaining the server-rendered raster boundary.
- Preserve the historical pitch, neutral white footballs, green server-confirmed selections and heavier readable numerals.
- Do not visually identify which pending football must be clicked next: remove the gold ring, glow or any equivalent next-target cue.
- Show a live countdown to the daily reset of the provisional global awards.
- Fix contradictory daily-limit states and neutral global-score rendering.

## Evidence

- PR #62 restored server-confirmed progressive responses but retained the green pitch and matrix digits introduced by PR #60/#61.
- The first PR #63 implementation restored only the pitch, white neutral fill and green completed fill. It omitted the historical numeral weight and was not a faithful restoration.
- A subsequent implementation also restored the historical gold active outline and glow from `public/human-check.js` at commit `016bb11c93065a796cf4985c617e0a32438ec260`.
- User review confirmed that the pitch, ball construction and numeral styling are now correct, but explicitly rejected the gold active state because it reveals which ball must be clicked next.
- The retained visual contract is:
  - pitch gradient `#620019 → #10121a → #12305f`;
  - translucent `#ffffff22` field lines;
  - neutral fill `#f7f8fb`;
  - completed fill `#54d18b`;
  - dark outline/pentagon `#11151d`;
  - `900`-weight historical `system-ui` numeral silhouettes represented by embedded alpha masks.
- All unconfirmed footballs must remain visually identical. Progress may change only the football atomically confirmed by the server.
- The historical completed numeral used a dark colour over the dark pentagon. This made the numeral disappear after confirmation. The implementation keeps the historical shape but uses white in every state for legibility.
- `normalizeDailyAttemptProfile()` previously trusted a redundant `attemptsLeft` value independently from used, reserved and maximum counts.
- The awards response previously omitted the canonical Madrid reset instant.
- The home scoreboard represented an empty 0–0 total as an invented 50% split.

## Decision

1. Keep challenge coordinates and hit geometry server-side. Public responses continue to expose only PNG data, dimensions, digest and lifecycle state.
2. Keep the historical pitch, neutral football, dark pentagon, diffuse shadow and heavy numeral silhouettes.
3. Remove all active-next-target styling. Pending footballs use the same neutral fill, outline and shadow regardless of which order value the server expects next.
4. Change only server-confirmed footballs to green. Every future pending football crop must remain byte-identical after progress.
5. Keep all numerals white for readable confirmation.
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

- **Next-target disclosure:** any distinct border, glow, fill, shadow or animation on one pending football would reveal the expected target. Tests compare pending-ball crops across every progress transition.
- **Visual drift:** tests assert exact retained RGBA constants, green confirmation and readable numeral pixel coverage.
- **Font drift:** runtime fonts are prohibited from owning the contract. The baked masks are the canonical numeral shapes.
- **Countdown drift:** the client consumes the server reset instant rather than rebuilding Madrid midnight.
- **Reset race:** only one refresh may run after expiry.
- **Rolling deployment:** missing `resetAt` degrades to an unavailable countdown.

## Acceptance

- [x] Coordinates and challenge geometry remain absent from public responses.
- [x] The pitch uses the historical burgundy/dark/blue gradient and field lines.
- [x] All pending footballs are visually identical; there is no gold ring, glow or equivalent next-target hint.
- [x] Each server-confirmed football changes to green without changing any future pending football.
- [x] Numerals 1–4 use the heavier historical browser silhouettes and remain readable in neutral and completed states.
- [x] Raster output is deterministic for identical layout and progress.
- [x] Minimum, default and maximum output dimensions are covered.
- [ ] Human-check raster tests pass with 100% lines, branches and functions on the final head.
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

## Rollback

- Revert the renderer and test commits normally.
- If the awards SQL migration has reached production, do not rewrite or delete it; use a forward migration for any contract change.

## Delivery

- Branch: `agent/fix-football-awards-reset`
- Base: `main`
- Pull request: `#63`
- Merge/deploy/release: not authorized

## Status

The gold next-target cue has been removed while preserving the approved pitch, football, numeral and green-confirmation design. Final-head CI and regenerated platform evidence are pending.
