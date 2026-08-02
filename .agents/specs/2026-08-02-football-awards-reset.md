# Legacy football styling, award reset countdown and daily-limit consistency

## Request

- Restore the visual quality and interaction feedback of the numbered footballs used before PR #60 without reverting the raster-only anti-cheat boundary.
- Show a live countdown to the daily reset of the provisional global awards.
- Fix the contradictory state where the daily-limit card shows `Vuelves a jugar en 24:00:00` while also showing `0 de 5 intentos usados hoy`.

## Evidence

- PR #60 correctly moved challenge geometry behind a server-rendered PNG, but the replacement pitch and football rendering lost the previous red/black/blue stadium treatment, active gold outline and smoother interaction hierarchy.
- The current raster renderer knows both the number of completed presses and which football is next, so the legacy completed and active states can be rendered server-side without exposing coordinates.
- `normalizeDailyAttemptProfile()` trusts a supplied `attemptsLeft` field independently from `attemptsUsed`, `dailyAttemptsReserved` and `maxAttempts`. A rolling or stale response can therefore claim zero remaining attempts while also claiming zero used attempts.
- The provisional awards already use the canonical `Europe/Madrid` day, but their response does not expose the canonical reset instant and the awards card has no countdown.

## Decision

1. Keep raster-only challenge delivery and server-confirmed presses. Do not restore client-visible geometry or client-side challenge drawing.
2. Reproduce the pre-PR-60 visual hierarchy inside the server raster: diagonal burgundy/black/blue pitch, subtle field lines, white footballs, green completed state, gold active outline/glow and readable numbers.
3. Derive `attemptsLeft` exclusively from `maxAttempts - attemptsUsed - attemptsReserved`. Treat that calculation as the canonical frontend projection and ignore contradictory redundant response fields.
4. Add `resetAt` to `get_game_daily_awards()` from the canonical `game_server_reset_at(game_server_day(...))` functions through a forward-only migration.
5. Reuse the existing daily countdown formatter in the awards renderer; do not duplicate countdown arithmetic.
6. At reset, stop the elapsed timer and request one authoritative home-statistics refresh. Do not permit repeated refreshes.
7. Cache-bust changed browser modules and add responsive styling without altering unrelated surfaces.

## Scope

- Shared human-check raster renderer and its strict 100% coverage tests.
- Daily-attempt normalization and regression tests.
- Awards SQL contract, home awards UI, countdown lifecycle and responsive styles.
- Unit, contract, real local Supabase and Desktop/Mobile Playwright coverage.
- Platform visual evidence for the football lifecycle and awards card.

## Risks

- **Security regression:** challenge geometry must remain absent from public responses; only PNG bytes, dimensions and digest remain visible.
- **Countdown drift:** the client must consume the server reset instant rather than reconstructing Madrid midnight.
- **Rolling deployment:** old award responses may omit `resetAt`; the UI must remain usable and show no misleading countdown until a complete response arrives.
- **Reset race:** a zero countdown may trigger multiple renders; guard the refresh and stop the interval before loading.
- **State contradiction:** account-level policy responses may omit used/reserved counts; defaults must still derive the correct remaining budget from `maxAttempts`.

## Acceptance

- [ ] The verification retains the raster-only anti-cheat contract and never exposes football coordinates.
- [ ] The pitch, footballs and active/completed states match the pre-PR-60 hierarchy while all four numbers remain readable.
- [ ] Each correct server-confirmed press visibly advances the completed state and moves the gold active state to the next football.
- [ ] `0 used + 0 reserved + max 5` always normalizes to 5 remaining, even when a stale payload says `attemptsLeft: 0`.
- [ ] The exhausted card cannot appear for a fresh `0 de 5` daily state.
- [ ] The awards card shows a live `HH:MM:SS` countdown using a server-supplied Madrid reset instant.
- [ ] The awards countdown reaches zero without becoming negative, performs one authoritative refresh and then follows the next reset.
- [ ] Missing `resetAt` degrades to an unavailable countdown rather than an invented client time.
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
- Pull request: pending
- Merge/deploy/release: not authorized

## Status

Implementation in progress.
