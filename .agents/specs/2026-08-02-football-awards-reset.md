# Exact pre-PR-60 football styling, award reset countdown and daily-limit consistency

## Request

- Restore the visual quality and interaction feedback of the numbered footballs used before PR #60 without reverting the raster-only anti-cheat boundary.
- Show a live countdown to the daily reset of the provisional global awards.
- Fix the contradictory state where the daily-limit card shows `Vuelves a jugar en 24:00:00` while also showing `0 de 5 intentos usados hoy`.
- Fix the empty global-score state so `0–0` does not fabricate a `50% · 50%` split and malformed negative scores cannot escape into the UI.

## Evidence

- PR #62 restored progressive server-confirmed feedback, but its renderer retained the PR #60 green pitch and matrix/pixel digits. It did not restore the pre-PR-60 canvas design.
- The pre-PR-60 owner at commit `016bb11c93065a796cf4985c617e0a32438ec260` used the exact diagonal gradient `#620019 → #10121a → #12305f`, `#ffffff22` field lines, smooth white circular footballs, a diffuse `#0009` shadow, dark `#11151d` outline/pentagon, white neutral numbers and `#54d18b` completed fill.
- The old renderer also highlighted the next target in gold. Restoring that cue would disclose which hidden target the server expects, so it is intentionally excluded while the completed green state is retained.
- `normalizeDailyAttemptProfile()` previously trusted a supplied `attemptsLeft` field independently from `attemptsUsed`, `dailyAttemptsReserved` and `maxAttempts`. A rolling or stale response could therefore claim zero remaining attempts while also claiming zero used attempts.
- The provisional awards already use the canonical `Europe/Madrid` day, but their response did not expose the canonical reset instant and the awards card had no countdown.
- The home scoreboard defaulted an empty total to 50%, which represented an invented tie rather than the absence of points.

## Decision

1. Keep raster-only challenge delivery and server-confirmed presses. Do not restore client-visible geometry or client-side challenge drawing.
2. Port the exact pre-PR-60 visual constants into the server raster and render at 3× resolution before downsampling so circles, shadows, outlines, field markings and vector digits are smooth rather than pixel-art.
3. Preserve only neutral and server-confirmed completed states. Do not render a next-target glow or alter any unselected future football.
4. Derive `attemptsLeft` exclusively from `maxAttempts - attemptsUsed - attemptsReserved`. Treat that calculation as the canonical frontend projection and ignore contradictory redundant response fields.
5. Add `resetAt` to `get_game_daily_awards()` from the canonical `game_server_reset_at(game_server_day(...))` functions through a forward-only migration.
6. Reuse the existing daily countdown formatter in the awards renderer; do not duplicate countdown arithmetic.
7. At reset, clamp to `00:00:00`, wait for an in-flight initial statistics request to settle, then request one authoritative refresh. Do not permit repeated refreshes.
8. Normalize team scores to finite non-negative values. When both are zero, render `Sin puntos`, a neutral track and `aria-valuetext="Sin puntos globales verificados"`.
9. Cache-bust changed browser modules and add responsive styling without altering unrelated surfaces.

## Scope

- Shared human-check raster renderer and its strict 100% coverage tests.
- Daily-attempt normalization and regression tests.
- Awards SQL contract, home awards UI, countdown lifecycle and responsive styles.
- Empty/invalid global-score rendering and accessibility contract.
- Unit, contract, real local Supabase and Desktop/Mobile Playwright coverage.
- Platform visual evidence for the football lifecycle, awards card and corrected states.

## Risks

- **Security regression:** challenge geometry must remain absent from public responses; only PNG bytes, dimensions and digest remain visible. A next-target visual cue is also prohibited.
- **Visual false positive:** checking only isolated colors allowed PR #62 to claim restoration while retaining pixel-art geometry. Tests must assert the exact style constants, anti-aliased edges, diffuse shadow, vector-number color distribution and unchanged future-ball crops.
- **Runtime cost:** supersampling increases CPU and temporary memory. Keep the output bounded to 320–640 × 220–480 and the internal scale fixed at 3×.
- **Countdown drift:** the client must consume the server reset instant rather than reconstructing Madrid midnight.
- **Rolling deployment:** old award responses may omit `resetAt`; the UI must remain usable and show no misleading countdown until a complete response arrives.
- **Reset race:** a zero countdown may trigger multiple renders; guard the refresh and stop the interval before loading.
- **State contradiction:** account-level policy responses may omit used/reserved counts; defaults must still derive the correct remaining budget from `maxAttempts`.

## Acceptance

- [ ] The verification retains the raster-only anti-cheat contract and never exposes football coordinates or a next-target cue.
- [ ] The pitch uses the exact pre-PR-60 burgundy/dark/blue gradient and translucent field-line constants.
- [ ] Football circles, outlines, shadows, pentagons and numbers are smooth and no longer use matrix/pixel glyphs.
- [ ] Each correct server-confirmed press changes only that football to the legacy green completed state; every future football remains byte-identical.
- [ ] `0 used + 0 reserved + max 5` always normalizes to 5 remaining, even when a stale payload says `attemptsLeft: 0`.
- [ ] The exhausted card cannot appear for a fresh `0 de 5` daily state.
- [ ] The awards card shows a live `HH:MM:SS` countdown using a server-supplied Madrid reset instant.
- [ ] The awards countdown reaches zero without becoming negative, performs one authoritative refresh and then follows the next reset.
- [ ] Missing `resetAt` degrades to an unavailable countdown rather than an invented client time.
- [ ] `0–0` displays `Sin puntos`; negative, infinite and invalid team values are clamped to zero.
- [ ] Unit, strict coverage, security, local Supabase, Desktop/Mobile Playwright and platform-evidence checks pass.

## Checks

- `pnpm check`
- `pnpm test:human-check-raster:coverage`
- `pnpm test:daily-attempts:coverage`
- `pnpm test:supabase`
- `pnpm test:e2e`
- Pull-request CI and platform evidence workflows

## Rollback

- Revert frontend and raster changes normally.
- If the SQL migration has reached production, do not rewrite or delete it. Add a forward migration restoring the previous function shape only after confirming all consumers tolerate removal of `resetAt`.

## Delivery

- Branch: `agent/fix-football-awards-reset`
- Base: `main`
- Pull request: `#63`
- Merge/deploy/release: not authorized

## Status

Implementation and final-head validation in progress.
