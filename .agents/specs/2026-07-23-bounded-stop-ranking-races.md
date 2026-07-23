# Bounded stop and ranking race fixes

## Request

- Prevent a player from stopping before the visible timer is concealed.
- Automatically finish and consume the attempt at 30.000 seconds.
- Replace the separate readiness overlay/canvas with the same visual stop control: `ESTOY LISTO`, then `3`, `2`, `1`, then the final `PARAR` state.
- Keep the gameplay surface and instructions visible before readiness so the player can read them without an overlay.
- Diagnose and remove intermittent empty/stuck home ranking states and missing daily-award flags.
- Cover response-order races, delayed data and repeated browser executions.

## Evidence

- The browser enabled the final control based on a later DOM observer, while the control itself had no minimum elapsed guard.
- The database accepted client durations from 500 to 30,000 ms but rejected server durations outside 8,000–18,000 ms. This contract produced the reported `La duración no es válida` error for legitimate early/late presses.
- Prepared challenges already expire 30 seconds after their server-anchored start, but the browser did not submit an automatic timeout result.
- `app.js` and `v4.js` independently fetched and rendered the home ranking. `app.js` emitted legacy rows without `.leaderboard-row-link`; if that slower response arrived last, `home-ranking-density.js` correctly waited for fields that could never appear and hid the list.
- Daily awards mutated each target while asynchronous team-profile lookups were still in flight. The generation check happened only after those mutations, so an older response could overwrite a newer flag.

## Decision

1. Use the existing closed-shadow canvas stop control for readiness, countdown and final stop. No readiness overlay or second visual control.
2. Enforce the hidden-timer gate twice:
   - UI state keeps the final control disabled until concealment.
   - The control rejects any final press whose elapsed value is below 2,000 ms.
3. Schedule one automatic finish at 30,000 ms. The automatic signal is explicit, nonce-bound and validated server-side; it does not pretend to be a pointer event.
4. Add an additive migration that aligns server timing with the published 2–30 second game window and permits a narrowly validated timeout finish with bounded network grace.
5. Render all home ranking responses through the same complete row contract and prevent stale duplicate loaders from replacing a ready list.
6. Resolve all daily-award teams before committing any DOM update; only the latest generation may commit.

## Scope

- Frontend gameplay lifecycle and copy.
- Stop-control presentation API.
- Ready/countdown orchestration.
- Home ranking rendering and loading state.
- Daily-award atomic rendering.
- Edge signal normalization.
- Additive PostgreSQL timing/timeout migration.
- Unit, security, Supabase integration and Playwright race tests.

## Risks

- A timeout request can reach the backend slightly after the 30-second challenge expiry. The migration grants only a bounded grace period and requires an exact 30,000 ms automatic signal tied to the challenge nonce.
- Replacing the readiness surface changes a security-sensitive interaction. The control remains canvas-only in a closed shadow root, pointer-only for manual finishes, and the server remains authoritative.
- Duplicate ranking requests remain for compatibility, but every renderer now emits the same complete contract and stale retries stop once a ready list exists.

## Acceptance

- The final stop cannot submit before the timer is concealed.
- The same control displays `ESTOY LISTO`, `3`, `2`, `1`, and then `PARAR` without overlapping controls or an overlay.
- At 30.000 seconds the attempt is submitted once and consumed.
- A valid manual stop from 2.000 through 30.000 seconds is accepted subject to existing integrity checks.
- Home ranking remains visible regardless of which stats request resolves first.
- Loading text is not treated as a completed empty ranking.
- Daily-award rows never receive a stale/missing flag after a newer response.
- Desktop and mobile Playwright scenarios cover delayed/reordered responses and the gameplay lifecycle.
- New deterministic controllers retain 100% line/function/branch coverage where applicable.

## Validation plan

- Syntax, ESLint, Knip, Vitest and security suite.
- Native V8 100% coverage gates for readiness/timing helpers.
- Fresh local Supabase migration rebuild and API journey.
- Manual pointer finish after concealment, early press rejection and automatic 30-second finish.
- Playwright desktop/mobile delayed-response matrix, repeated multiple times with zero retries.
- CI reruns of the browser job after an initial green run.

## Rollback

- Revert the application, Edge Function, tests and stylesheet changes.
- Do not edit or delete an applied migration. If database behavior must be reverted after deployment, add a forward corrective migration redefining the two timing functions.

## Delivery

- Branch: `agent/fix-bounded-stop-ranking-races`
- PR: pending
- CI: pending

## Status

In progress.
