# Achievement unlock event ordering

## Request

Investigate why the production achievement unlock notification does not appear for new or existing players after PR #33 was merged and deployed, then correct the runtime behavior with regression coverage.

## Evidence

- `public/attempt-refresh.js` intercepts `window.fetch`, decodes the cloned `finish` response asynchronously, and publishes `minuto106:attempt-finished`.
- `public/app.js` concurrently decodes the original `finish` response and then calls `Minuto106Competition.handleResult(data)`.
- `public/competition.js` replaces the cached profile with the post-attempt profile and publishes `minuto106:player-context` with source `finish:global`.
- `public/achievement-unlocks.js` uses the latest `player-context` profile as its mutable baseline. When `finish:global` wins the response-decoding race, the baseline already equals the new profile before `attempt-finished` arrives, so the achievement delta is empty.
- Existing tests publish `attempt-finished` directly and do not reproduce the real production ordering.

## Decision

Replace the fetch-response interception with an explicit completion publisher called by the game flow after a successful `finish` response. The completion event will carry the exact pre-attempt profile baseline, making delta detection independent of asynchronous response parsing and `player-context` ordering.

## Scope

- Add a small public completion publisher to `attempt-refresh.js`.
- Publish the completion once from `app.js`, with the profile captured before the finish request mutates local state.
- Make `achievement-unlocks.js` prefer the event-scoped baseline while retaining the current context fallback for external callers.
- Add unit coverage for the production ordering where `finish:global` context is published before the completion event.
- Add browser coverage proving a real first-attempt unlock is visible through the production event path.

## Risks

- Duplicate completion events could show duplicate notifications or corrupt the latest share result. The fetch interceptor must be removed, and tests must assert one publication.
- New-player profiles have no previous baseline. `null` must be preserved as an intentional baseline rather than treated as a missing field.
- League attempts must continue to publish the latest attempt for sharing without inventing global achievement deltas.

## Acceptance

- A newly unlocked achievement is announced even if the post-finish player context is published first.
- A new player can receive the first unlocked achievement notification.
- Existing achievements are not replayed when no achievement changed.
- Exactly one `minuto106:attempt-finished` event is published for each successful finish.
- Failed and unrelated API calls publish no completion event.
- Existing result sharing still receives the latest completed attempt.
- Unit, security, browser, and visual-evidence checks pass.

## Validation

Pending.

## Delivery

- Branch: `agent/fix-achievement-unlock-event-order`
- Pull request: pending
- Deployment: not authorized

## Status

In progress.
