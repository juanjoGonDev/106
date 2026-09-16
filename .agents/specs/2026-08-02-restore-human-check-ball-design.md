# Request

Restore the pre-PR-#60 football appearance in the human verification while retaining the opaque server-rendered raster boundary. Each correct press must be confirmed by the server and then visibly change that football to the completed state.

# Evidence

- The pre-PR-#60 implementation at `016bb11c93065a796cf4985c617e0a32438ec260` rendered a white circular football with a dark outline, drop shadow, central dark pentagon and centred number.
- Its completed state used a green `#54d18b` fill.
- Its active-next state used a yellow glow and outline and accompanying next-number text. Those cues are deliberately not restored because they disclose the expected answer.
- The merged raster implementation returned one opaque PNG and validated all four clicks only after the browser had collected them, so it could not provide server-confirmed feedback per press.
- The PostgreSQL row already owned the hidden layout, device/IP binding, expiry, completion and one-use proof state.

# Decision

1. Keep one existing `game_human_checks` record and add minimal progressive state: `selected_count` and `state_version`.
2. Add one forward-only migration with one service-role RPC that locks the row, validates one click against the next hidden ball, atomically advances once, and issues the existing proof only on the fourth click.
3. Return the hidden layout only from the service-role RPC to the Edge Function. The public HTTP response contains only `selectedCount`, `stateVersion`, lifecycle data and a new opaque PNG/digest.
4. Render the legacy neutral/completed football language in the shared raster owner. Never render an active-next style.
5. Replace browser-side four-click accumulation with one request per press. Update the image and progress only after a successful server response and loaded replacement PNG.
6. Preserve the guarded localhost-only solution endpoint for deterministic real-stack tests. It remains disabled outside explicit local test configuration.
7. Retire the normal all-at-once completion contract with HTTP 410. Existing legacy test scripts use a local-only adapter that submits their four deterministic clicks through the progressive public contract.

# Scope

- Shared raster appearance and progress rendering.
- Progressive Edge Function contract.
- One forward-only PostgreSQL migration and atomic RPC.
- Browser interaction and cancellation/focus compatibility.
- Unit, security, local Supabase, concurrency and Desktop/Mobile Playwright coverage.
- Final-head full platform evidence.
- Migration-aware player-card cache revision required by repository policy.

# Risks

- A duplicate request could advance twice without row locking and version checks.
- Updating progress before replacement-image load could show an inconsistent state.
- Returning internal RPC fields directly could expose the hidden solution.
- The previous active glow or status copy could disclose the next expected ball.
- A malformed out-of-range coordinate is rejected before reaching a challenge and must not be confused with a valid but incorrect press, which invalidates the challenge.
- Cached frontend code could call the retired completion action unless the changed script receives a new asset revision.

# Implementation

- `supabase/migrations/20260802210500_progressive_human_check_raster.sql` adds `selected_count`, `state_version`, constraints and the service-role-only `advance_game_human_check_raster` RPC.
- The RPC checks lifecycle, device/IP binding, expected version, pointer data and the next hidden ball under `FOR UPDATE`.
- A valid incorrect press consumes the challenge. Malformed public input is rejected before challenge mutation.
- Correct presses persist one state transition. The fourth stores the proof hash and returns one proof token through the Edge Function.
- `human-check-click` returns only the opaque replacement PNG and public progress. The internal `balls` field is removed before the HTTP boundary.
- The shared raster restores white neutral footballs and green completed footballs with dark outline, shadow, pentagon and centred light number.
- The browser serializes presses, shows “checking” feedback, waits for the replacement PNG to load and only then advances visible progress.
- The home page cache-busts the progressive client and all migration-aware radar consumers use revision `20260802210501`.

# Tests

- Decode PNG pixels for neutral/completed states at progress 0–4 and minimum/default/maximum dimensions.
- Assert legacy silhouette, shadow, outline, pentagon, number contrast and green completed fill.
- Assert stable layout and changing digest across progress states, while unselected footballs remain visually unchanged.
- Real local PostgreSQL/Edge tests cover correct sequence, valid incorrect click, malformed input boundary, replay, duplicate/different concurrency and one proof issuance.
- Public HTTP contract tests prove no coordinates/order/radius leak.
- Desktop/Mobile Playwright presses each ball, waits for the server response and digest change, and verifies only confirmed balls become completed.
- Cancellation, focus restoration, console/network/overflow and no-next-hint assertions remain covered.
- Platform evidence requires initial, one-selected and four-selected PNGs plus a real WebM/GIF progression for Desktop and Mobile.

# Acceptance

- Footballs visually match the old neutral and completed language as closely as practical.
- Numbers 1–4 remain readable only inside the raster footballs.
- Each completed state appears only after server confirmation.
- Previously completed balls remain green; all remaining balls stay neutral with no next-target cue.
- Incorrect/replayed/concurrent requests cannot disclose or double-advance state.
- Proof is issued exactly once after the fourth valid press.
- All mandatory tests, CodeQL, local Supabase suites, Desktop/Mobile evidence and quality gates pass on one final commit.

# Checks

The implementation head immediately before this documentation-only commit passed:

- build, syntax, public asset audit, ESLint, Knip and Vitest;
- dependency/security policy checks;
- local Supabase security, migrations, gameplay-core, gameplay-sharing, auth API and auth browser suites;
- local Supabase `ready-flow`, including valid incorrect press, replay/concurrency and real Desktop/Mobile journeys;
- CodeQL for Actions and JavaScript/TypeScript;
- all Desktop/Mobile evidence shards and the complete platform inventory.

The documentation commit intentionally triggers the same required workflows again. PR metadata owns the final SHA, final workflow run IDs and final artifact digest so this specification does not require a further documentation commit after validation.

# Delivery

- Branch: `agent/fix-restore-human-check-footballs`
- PR: `#62`
- Migration: `supabase/migrations/20260802210500_progressive_human_check_raster.sql`
- One normal PR against `main`.
- No merge, deploy, production migration, secret change or alert dismissal was performed.

# Status

Implemented. Final-head CI and artifact linkage are the remaining delivery gates recorded on the pull request.
