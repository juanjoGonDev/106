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
8. Keep previous versioned styles immutable and load the new `v17.css` relative to the notification script URL.

## Scope

- `public/achievement-unlocks.js`
- `public/attempt-refresh.js`
- `public/v17.css`
- focused strict-coverage Node tests
- desktop/mobile Playwright journeys and preview captures
- package syntax/coverage commands and Knip registration

## Acceptance

- [x] A successful finish that adds one achievement displays exactly one notification.
- [x] Multiple achievements unlocked by the same finish display sequentially without overlap.
- [x] Existing achievement codes are never notified again.
- [x] Invalid, duplicate or missing achievement records are ignored safely.
- [x] The notification contains the title, description and positive points when available.
- [x] World-record and top-10 animations complete before the achievement notification starts.
- [x] The surface is responsive, does not block interaction and remains inside safe-area insets.
- [x] Screen readers receive one polite atomic status announcement per achievement.
- [x] Reduced-motion users receive the same information without movement or shine animations.
- [x] New and modified event modules maintain 100% line, function and branch coverage.
- [x] Required repository and browser CI workflows are green on the implementation head.

## Risks

- A missing baseline could expose old achievements as new. Mitigation: retain the latest player context before loading the notifier; a genuinely new player has no historical baseline and all first-attempt unlocks are valid.
- Several thresholds can unlock at once and create a long sequence. Mitigation: use a deterministic queue with a bounded display duration and no modal interaction.
- Existing rank celebrations can overlap. Mitigation: apply explicit delays based on the server-provided world-record and top-10 flags.
- Dynamically loading the asset could duplicate listeners. Mitigation: guard both the loader element and the notifier boot state.
- A modified historical stylesheet could remain cached. Mitigation: keep `v14.css` unchanged and load the new immutable `v17.css` from the script's absolute URL.

## Tests

- Strict Node coverage for achievement normalization, delta detection, duplicate suppression and empty inputs.
- Strict Node coverage for immediate and delayed display, sequential queues, point/no-point rendering, exit lifecycle, destruction and versioned stylesheet loading.
- Event integration coverage for retained player context, successful finish publication, world-record/top-10 delays and invalid profile payloads.
- Playwright coverage for desktop/mobile layout, visible copy, point rendering, viewport containment and reduced-motion behavior.
- Syntax, ESLint, Knip, Vitest, public-asset checks and browser workflows remain authoritative in CI.

## Validation

Implementation head `94a71b88c37ed5b65d9252b9e29df83de76e25b0` passed:

- Pull Request Quality Pipeline `30162854080`: build, frozen install, syntax, ESLint, Knip, Vitest, dependency/security policy and local Supabase API integration succeeded.
- Player Pages and Social Cards `30162854049`: strict frontend module coverage and all responsive Playwright journeys succeeded; desktop/mobile preview artifacts were uploaded.
- Public Asset Audit `30162854090`: public media, tooling coverage and visual-evidence enforcement succeeded.
- Pull Request Visual Evidence `30162854046`: PR evidence structure succeeded.

The branch browser workflow captures `achievement-unlock-desktop.png` and `achievement-unlock-mobile.png`. The documentation-only closure commit must pass the same required PR checks before merge readiness is final.

## Rollback

Revert the notification module, loader/event baseline changes, styles, tests and tooling registration. No database, API, permission or persisted-data rollback is required.

## Delivery

- Branch: `agent/feat-achievement-unlock-notifications`
- Pull request: `#33`
- Base: `main`
- Normal pull request; no merge or deployment without explicit authorization.

## Status

Implementation and validation complete. Awaiting required CI confirmation for this documentation-only closure commit.
