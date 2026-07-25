# Achievement unlock notifications

## Request

Add animations and a video-game-style notification whenever a player unlocks an achievement.

## Evidence

- The finish response already contains the refreshed player profile, including the complete `achievements.items` collection.
- `attempt-refresh.js` publishes every successful finish as `minuto106:attempt-finished` and keeps the latest attempt available for late-loaded modules.
- Player context is published separately through `minuto106:player-context`, which provides a safe baseline for detecting newly added achievement codes.
- A single attempt can unlock several cumulative or precision thresholds, so the UI requires an ordered queue rather than a one-off toast.
- World-record and top-10 celebrations already use a full-screen animation and must not be visually covered by the new notification.

## Decision

1. Detect unlocked achievements by comparing the last known profile achievement codes with the refreshed profile in the successful finish event.
2. Keep the detector and queue in a dedicated `achievement-unlocks.js` browser module loaded by the existing attempt event bridge.
3. Render one fixed, non-interactive, accessible notification at a time and queue additional unlocks in profile order.
4. Display the achievement title, description and positive point reward without injecting profile HTML.
5. Delay the first notification while an existing world-record or top-10 celebration is active.
6. Use motion for slide-in, badge impact and shine, while fully respecting `prefers-reduced-motion`.
7. Persist the most recent player context in the attempt bridge so late module loading does not treat previously earned achievements as new.

## Scope

- `public/achievement-unlocks.js`
- `public/attempt-refresh.js`
- `public/v14.css`
- focused strict-coverage Node tests
- package syntax/coverage commands and Knip registration

## Acceptance

- [ ] A successful finish that adds one achievement displays exactly one notification.
- [ ] Multiple achievements unlocked by the same finish display sequentially without overlap.
- [ ] Existing achievement codes are never notified again.
- [ ] Invalid, duplicate or missing achievement records are ignored safely.
- [ ] The notification contains the title, description and positive points when available.
- [ ] World-record and top-10 animations complete before the achievement notification starts.
- [ ] The surface is responsive, does not block interaction and remains inside safe-area insets.
- [ ] Screen readers receive one polite atomic status announcement per achievement.
- [ ] Reduced-motion users receive the same information without movement or shine animations.
- [ ] New and modified event modules maintain 100% line, function and branch coverage.

## Risks

- A missing baseline could expose old achievements as new. Mitigation: retain the latest player context before loading the notifier; a genuinely new player has no historical baseline and all first-attempt unlocks are valid.
- Several thresholds can unlock at once and create a long sequence. Mitigation: use a deterministic queue with a bounded display duration and no modal interaction.
- Existing rank celebrations can overlap. Mitigation: apply explicit delays based on the server-provided world-record and top-10 flags.
- Dynamically loading the asset could duplicate listeners. Mitigation: guard both the loader element and the notifier boot state.

## Tests

- Strict Node coverage for achievement normalization, delta detection, duplicate suppression and empty inputs.
- Strict Node coverage for immediate and delayed display, sequential queues, point/no-point rendering, exit lifecycle and destruction.
- Event integration coverage for retained player context, successful finish publication, world-record/top-10 delays and invalid profile payloads.
- Syntax, ESLint, Knip, Vitest, public-asset checks and browser workflows remain authoritative in CI.

## Rollback

Revert the notification module, loader/event baseline changes, styles, tests and tooling registration. No database, API, permission or persisted-data rollback is required.

## Delivery

- Branch: `agent/feat-achievement-unlock-notifications`
- Base: `main`
- Normal pull request; no merge or deployment without explicit authorization.

## Status

Implementation in progress.
