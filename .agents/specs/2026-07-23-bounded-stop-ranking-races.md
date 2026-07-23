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
- Prepared challenges already expired 30 seconds after their server-anchored start, but the browser did not submit an automatic timeout result.
- `app.js` and `v4.js` independently fetched and rendered the home ranking. `app.js` emitted legacy rows without `.leaderboard-row-link`; if that slower response arrived last, `home-ranking-density.js` waited for fields that could never appear and hid the list.
- Daily awards mutated each target while asynchronous team-profile lookups were still in flight. The generation check happened only after those mutations, so an older response could overwrite a newer flag.
- A fresh attempt result also triggered a redundant stats request that could replace the newer award snapshot with an older server response.

## Decision

1. Use the existing closed-shadow canvas stop control for readiness, countdown and final stop. No readiness overlay or second visual control.
2. Enforce the hidden-timer gate twice:
   - UI state keeps the final control disabled until concealment.
   - The control rejects any final press whose elapsed value is below 2,000 ms.
3. Schedule one automatic finish at 30,000 ms. The automatic signal is explicit, nonce-bound and validated server-side.
4. Add an additive migration that aligns server timing with the published 2–30 second game window and permits a narrowly validated timeout finish with bounded network grace.
5. Normalize every home-ranking response into the same complete row contract before exposing the list.
6. Resolve all daily-award teams before committing any DOM update; only the latest generation may commit, and fresh attempt statistics do not trigger a redundant fetch.

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
- Duplicate ranking requests remain for compatibility, but every renderer is normalized before the list becomes visible.

## Acceptance

- [x] The final stop cannot submit before the timer is concealed.
- [x] The same control displays `ESTOY LISTO`, `3`, `2`, `1`, and then `PARAR` without overlapping controls or an overlay.
- [x] At 30.000 seconds the attempt is submitted once and consumed.
- [x] A valid manual stop from 2.000 through 30.000 seconds is accepted subject to existing integrity checks.
- [x] Home ranking remains visible regardless of which stats request resolves first.
- [x] Loading text is not treated as a completed empty ranking.
- [x] Daily-award rows cannot receive a stale/missing flag after a newer response.
- [x] Desktop and mobile Playwright scenarios cover delayed/reordered responses and the gameplay lifecycle.
- [x] The readiness and bounded-timing controllers retain 100% line/function/branch coverage.

## Validation

- Quality pipeline run `30029736789` passed syntax, Vitest, security, ESLint, Knip, dependency policy, local Supabase rebuild/API journeys and its final quality gate.
- Player/browser run `30029736993` passed desktop and mobile Playwright journeys and every 100% frontend-module coverage gate.
- The browser job was rerun twice on the same final implementation tree (`89283492201` and `89283828131`); both reruns passed without retries or code changes.
- The local Supabase journey validated a real manual finish at 2,200 ms and an exact automatic 30,000 ms completion through the Edge Function and PostgreSQL migration.
- The browser race test performs eight consecutive legacy-ranking replacements in both viewport projects and verifies stale award lookups cannot overwrite the newest flags.
- Passing browser evidence was captured in artifact `8572439645`, digest `sha256:df40438a3dbc86d68406c9ef97d8346cc98ccf6d4153ca7b5774aaf14221a243`.
- Immutable desktop/mobile evidence is attached to PR `#23`; generated evidence files are absent from the final branch tree.

## Rollback

- Revert the application, tests and stylesheet changes.
- Do not edit or delete an applied migration. If database behavior must be reverted after deployment, add a forward corrective migration redefining the two timing functions.

## Delivery

- Branch: `agent/fix-bounded-stop-ranking-races`
- PR: `#23` — `fix(game): bound attempts and eliminate ranking races`
- Implementation tree CI: green across quality, browser, visual-evidence and public-asset workflows.
- Merge/deploy: not performed; explicit user approval is required.

## Status

Complete and ready for review. This final commit changes documentation only; the implementation tree and validated runtime behavior are unchanged.
