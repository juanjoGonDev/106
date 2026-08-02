# Request

Restore the pre-PR-#60 football appearance in the human verification while retaining the opaque server-rendered raster boundary. Each correct press must be confirmed by the server and then visibly change that football to the completed state.

# Evidence

- The pre-PR-#60 implementation at `016bb11c93065a796cf4985c617e0a32438ec260` rendered a white circular football with a dark outline, drop shadow, central dark pentagon and centred number.
- Its completed state used a green `#54d18b` fill.
- Its active-next state used a yellow glow and outline and accompanying next-number text. Those cues are deliberately not restored because they disclose the expected answer.
- The current implementation returns one opaque PNG and validates all four clicks only after the browser has collected them, so selected feedback is currently optimistic and cannot be server-confirmed per press.
- The current PostgreSQL row already owns the hidden layout, device/IP binding, expiry, completion and one-use proof state.

# Decision

1. Keep one existing `game_human_checks` record and add minimal progressive state: `selected_count` and `state_version`.
2. Add one forward-only migration with a single service-role RPC that locks the row, validates one click against the next hidden ball, atomically advances once, and issues the existing proof only on the fourth click.
3. Return the hidden layout only from the service-role RPC to the Edge Function. The public HTTP response contains only `selectedCount`, lifecycle data and a new opaque PNG/digest.
4. Render the legacy neutral/completed football language in the shared raster owner. Never render an active-next style.
5. Replace the browser's local four-click accumulation with one request per press. Update the image and progress only after a successful server response and loaded replacement PNG.
6. Preserve the guarded localhost-only legacy raster fixture solely for existing isolated browser fixtures. Real acceptance remains browser → Edge Function → PostgreSQL on local Supabase.

# Scope

- Shared raster appearance and progress rendering.
- Progressive Edge Function contract.
- One forward-only PostgreSQL migration and atomic RPC.
- Browser interaction and cancellation/focus compatibility.
- Unit, security, local Supabase, concurrency and Desktop/Mobile Playwright coverage.
- Final-head full platform evidence.

# Risks

- A duplicate request could advance twice without row locking and version checks.
- Updating progress before replacement-image load could show an inconsistent state.
- Returning internal RPC fields directly could expose the hidden solution.
- The previous active glow or status copy could disclose the next expected ball.
- Existing mocked visual suites may still use the retired structured fixture and need a local-only compatibility adapter.

# Tests

- Decode PNG pixels for neutral/completed states at progress 0–4 and minimum/default/maximum dimensions.
- Assert legacy silhouette, shadow, outline, pentagon, number contrast and green completed fill.
- Assert stable layout and changing digest across progress states.
- Real local PostgreSQL tests for correct sequence, wrong click, expiry, wrong device/IP, replay, duplicate/different concurrency and one proof issuance.
- Public HTTP contract tests proving no coordinates/order/radius leak.
- Desktop/Mobile Playwright presses each ball, waits for server response and digest change, and verifies only confirmed balls become completed.
- Cancellation, focus restoration, console/network/overflow and no-next-hint assertions.

# Acceptance

- Footballs visually match the old neutral and completed language as closely as practical.
- Numbers 1–4 remain readable only inside the raster footballs.
- Each completed state appears only after server confirmation.
- Previously completed balls remain green; all remaining balls stay neutral with no next-target cue.
- Incorrect/replayed/concurrent requests cannot disclose or double-advance state.
- Proof is issued exactly once after the fourth valid press.
- All mandatory tests, CodeQL, local Supabase suites, Desktop/Mobile evidence and quality gates pass on one final commit.

# Checks

Pending implementation and final-head CI validation.

# Delivery

- Branch: `agent/fix-restore-human-check-footballs`
- One normal PR against `main`.
- No merge, deploy, production migration, secret change or alert dismissal without explicit approval.

# Status

In progress.
