# Achievement unlock event ordering

## Request

Investigate why the production achievement unlock notification does not appear for new or existing players after PR #33 was merged and deployed, then correct the runtime behavior with regression coverage.

## Evidence

- `public/attempt-refresh.js` intercepts `window.fetch`, decodes the cloned `finish` response asynchronously, and publishes `minuto106:attempt-finished`.
- `public/app.js` concurrently decodes the original `finish` response and then calls `Minuto106Competition.handleResult(data)`.
- `public/competition.js` replaces the cached profile with the post-attempt profile and publishes `minuto106:player-context` with source `finish:global`.
- `public/achievement-unlocks.js` previously used the latest `player-context` profile as its mutable baseline. When `finish:global` won the response-decoding race, the baseline already equalled the new profile before `attempt-finished` arrived, so the achievement delta was empty.
- The original tests published `attempt-finished` directly and did not reproduce the real production ordering.

## Decision

Keep the existing completion interception because it also supplies the latest attempt to sharing code, but capture the player profile baseline synchronously before the `finish` request is sent. Publish that request-scoped baseline with the completion event and make the unlock notifier prefer it over mutable player context. This is the smallest change that removes response-decoding order from achievement delta detection without changing the backend contract.

## Scope

- Capture the pre-finish profile in `attempt-refresh.js` before awaiting the network response.
- Publish exactly one immutable completion payload containing `previousProfile` after a successful decoded response.
- Make `achievement-unlocks.js` prefer the event-scoped baseline while retaining the current context fallback for external completion publishers.
- Cover the production ordering where `finish:global` context is published before the completion event.
- Cover a new player whose intentional baseline is `null`.
- Exercise the refreshed-context ordering in the responsive browser journey and visual recording.

## Risks

- Duplicate completion events could show duplicate notifications or corrupt the latest share result. Regression tests assert exactly one completion publication.
- New-player profiles have no previous baseline. `null` is preserved as an explicit baseline and is distinguished from an absent compatibility field.
- Existing achievements must not replay. Delta detection still compares achievement codes and queues only newly added codes.
- League attempts must continue to publish the latest attempt for sharing. The existing completion event remains intact and gains only the baseline field.

## Acceptance

- A newly unlocked achievement is announced even if the post-finish player context is published first.
- A new player can receive the first unlocked achievement notification.
- Existing achievements are not replayed when no achievement changed.
- Exactly one `minuto106:attempt-finished` event is published for each successful finish.
- Failed and unrelated API calls publish no completion event.
- Existing result sharing still receives the latest completed attempt.
- Unit, strict coverage, lint, security, browser, Supabase integration, asset, and visual-evidence checks pass.

## Validation

Validated on implementation head `5423f9d1ebe1e6b5f28d504df13ab41e9b9e44ad`:

- Pull Request Quality Pipeline run `30171491696`: passed, including syntax, ESLint, Knip, unit/security tests, dependency policy, and local Supabase API integration.
- Player Pages and Social Cards run `30171491700`: passed, including 100% strict frontend module coverage and responsive browser journeys.
- Public Asset Audit run `30171491789`: passed.
- Pull Request Visual Evidence run `30171491694`: passed.
- Regression coverage reproduces the refreshed-context-before-completion ordering and the new-player `null` baseline.

The final documentation-only head must retain the same green workflow state before delivery.

## Delivery

- Branch: `agent/fix-achievement-unlock-event-order`
- Pull request: `#34`
- Merge: not authorized
- Deployment: not authorized

## Rollback

Revert PR #34. No database migration, backend contract, generated asset, or persisted-data rollback is required.

## Status

Implementation complete. Awaiting final CI on the documentation-only closure commit, then review and merge.
