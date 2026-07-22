# Ready countdown and captcha expiry

## Request

After the numbered-ball verification succeeds, do not start the game automatically. Show an explicit **Estoy preparado** action, then display a visible `3, 2, 1` countdown, and only start the timed attempt after the countdown completes. If the player does not press the ready action within two minutes of solving the verification, discard that proof and restart the complete flow from a new captcha.

## Evidence

- `public/human-check.js` currently resolves the verification promise directly from the post-captcha button.
- Resolving that promise completes the server proof and immediately forwards the original `start` request.
- The current post-captcha action has no formal state machine, no local two-minute ready deadline, and no countdown.
- Generic server retry limits would eventually stop refreshing expired checks instead of reliably returning to a fresh captcha.

## Decision

- Introduce a focused browser-compatible ready/countdown state controller.
- Keep the sequence explicit: `solving -> ready -> countdown -> complete`.
- Start a local 120-second deadline only after the fourth ball is selected correctly.
- Treat local or server verification expiry as a refresh condition that obtains a fresh server check without consuming the bounded network-failure budget.
- Require a trusted pointer-generated click on **Estoy preparado**.
- Render `3`, `2`, and `1` at one-second intervals; resolve the visual proof only after the final interval.
- Keep cancellation available and make cleanup idempotent for timers, resize handlers, overlay removal, and viewport restoration.

## Acceptance criteria

- Selecting the fourth ball never forwards the game start request.
- The ready button text is exactly `Estoy preparado`.
- The timed attempt cannot start without one trusted ready click.
- The countdown visibly emits `3`, then `2`, then `1`, one second apart.
- The start request is forwarded only after the countdown completes.
- Waiting 119,999 ms preserves the ready state; waiting 120,000 ms refreshes the entire captcha.
- Repeated captcha expiry can refresh again without exhausting the network retry budget.
- Clicking twice, stale timers, cancellation, resize, and cleanup cannot start more than one attempt.
- The action area remains dimensionally stable on short portrait, landscape, tablet, and desktop layouts.
- The new ready/countdown controller has enforced 100% line, function, and branch coverage.

## Validation plan

- Node built-in test runner with native V8 coverage thresholds at 100% for the state controller.
- Vitest integration contract that executes and enforces the coverage command in CI.
- Static integration tests for script order, trusted ready interaction, exact labels, countdown rendering, expiry refresh, one-time proof forwarding, and stable responsive CSS.
- Existing Vitest, ESLint, Knip, security, syntax, and Supabase integration pipeline.

## Risks

- Starting the server attempt before the countdown would charge elapsed network/UI time to the player. Mitigation: complete the countdown before forwarding the original start request.
- A stale ready or countdown timer could race with cancellation. Mitigation: phase guards plus explicit timer cancellation and idempotent settlement.
- Infinite refresh on real network failures could create a retry loop. Mitigation: only recognized expiry conditions refresh indefinitely; unrelated server/network failures remain bounded.

## Rollback

Revert the pull request. There are no database, migration, Edge Function, or API contract changes.

## Delivery

- Branch: `agent/fix-ready-countdown-expiry`
- Base: deployed `main` after PR #10.
- Normal pull request to `main`; no merge or deployment without explicit approval.

## Status

Tests specified; implementation pending.
