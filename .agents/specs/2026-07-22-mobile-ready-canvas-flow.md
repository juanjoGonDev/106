# Mobile ready canvas flow

## Request

Correct the deployed game sequence so solving the numbered-ball captcha never starts a countdown. After the captcha succeeds, close the modal and show a pointer-only canvas action labelled **Estoy preparado** over the already prepared game surface. Only a trusted pointer press inside that canvas target may start `3, 2, 1`. When the countdown finishes, the timer and final stop control must become visible without a perceptible gap. The stop control must remain disabled until the visible timer is concealed.

A solved verification may wait at most two minutes for the ready action. Expiry restarts the complete `captcha -> ready canvas -> countdown -> game` sequence. Any incorrect captcha press must discard the current server check and request a completely new layout with different ball positions. The modal must remain mounted during regeneration to avoid flicker and expose a loading state only when regeneration is not immediate.

## Evidence

- The deployed PR #11 renders the ready action and countdown inside the captcha modal.
- The same overlay owns `solving`, `ready`, and `countdown`, so mobile pointer/render timing can advance directly from the final ball to countdown.
- Incorrect input currently resets the local click array while retaining the same server check and ball coordinates.
- The game challenge is created only after the countdown, so the real stop control cannot be prepared underneath the ready surface.
- The final stop control is enabled immediately when mounted rather than when the timer becomes concealed.
- Human-check rows currently expire 90 seconds after creation, which does not implement a two-minute post-solve ready window.

## Decision

- Keep the captcha as a modal used only for numbered-ball solving.
- Maintain one modal instance while loading/regenerating checks; never close and reopen it for an incorrect press.
- Treat incorrect input as a server-check refresh, not a local sequence reset.
- Send the prior geometry when requesting a replacement and reject any replacement that does not materially move every ordered ball.
- After server proof completion, close the modal and prepare a dormant server challenge before exposing the ready canvas.
- Add explicit prepare and activate actions. Preparation consumes the one-time proof and returns the final interaction without starting timing. Activation schedules `started_at` three seconds in the future.
- Render the ready target and countdown in a randomized canvas target outside the modal, over the active game panel.
- Mount a disabled preview of the final stop control underneath the readiness layer; replace it with the real server control atomically when the app receives the activated challenge.
- Gate the real stop control until the timer receives its concealed state.
- Preserve the existing `start` API for compatibility; the browser interceptor uses the new prepare/activate actions.

## Acceptance criteria

- Final captcha selection closes the captcha modal and never starts countdown.
- A visible canvas target says `ESTOY PREPARADO` and accepts trusted mouse, touch, or pen input only inside its randomized bounds.
- No HTML button or stable ready selector is exposed for the ready action.
- The active game panel, timer placeholder, and disabled final-control preview are already rendered beneath the readiness layer.
- Ready press emits exactly `3`, `2`, `1`; no value is skipped on touch input.
- On normal network latency, countdown completion reveals the running timer and real stop control in the next animation frame with no modal transition.
- The final control cannot fire while countdown runs or while the timer remains visible; it becomes enabled when the timer is concealed.
- Waiting 120,000 ms without ready abandons the prepared challenge and opens a newly generated captcha.
- Incorrect captcha input keeps one modal mounted, shows a delayed loading state if required, obtains a new check ID, and displays materially different coordinates.
- Cancellation and stale callbacks cannot create or activate more than one attempt.
- Desktop mouse and representative mobile touch viewport flows are covered by deterministic tests.
- New readiness/layout controller logic has enforced 100% line, function, and branch coverage.

## Validation

- Node 22 native V8 coverage at 100% lines/functions/branches for the pure readiness and geometry controller.
- Vitest integration contracts for modal separation, no HTML ready button, persistent regeneration, delayed loading, prepare/activate ordering, stop gating, and responsive layout.
- Local Supabase journey for prepare, two-minute ready expiry, activation scheduling, one-time activation, mobile touch finish, and replacement captcha geometry.
- Existing syntax, ESLint, Knip, security, migration lint/rebuild, and production-snapshot checks.

## Risks

- A prepared challenge may be abandoned. It does not consume an attempt and expires automatically; rate limits still bound creation.
- Network latency between ready press and activation slightly shifts the server start relative to the client countdown. Scheduling timing three seconds after server activation keeps the delta to network latency rather than the full countdown.
- A slow activation response may outlast the countdown. The non-modal readiness layer remains and displays `Cargando intento…` until activation succeeds; timing starts from the server timestamp returned.

## Rollback

Revert the pull request. The migration is additive; prepared challenge columns and RPCs can remain unused safely after frontend rollback.

## Delivery

- Branch: `agent/fix-mobile-ready-canvas-flow`
- Base: deployed `main` containing PR #11.
- Normal pull request to `main`; no merge or deployment without explicit approval.

## Status

Implementation in progress.
