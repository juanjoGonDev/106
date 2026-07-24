# Disable mobile page zoom

## Request

- Prevent users from enlarging the game page with a two-finger pinch gesture on mobile.
- Preserve the existing browser theme color and safe-area treatment.
- Correct the behavior merged in PR #24, which only reduced accidental double-tap zoom.

## Evidence

- The merged viewport is `width=device-width,initial-scale=1,viewport-fit=cover`; it has no maximum scale or user-scalable restriction.
- The shared browser stylesheet uses `touch-action: manipulation`, which explicitly permits pinch zoom.
- The previous test asserted that pinch zoom remained available, so CI protected the opposite behavior from the requested one.

## Decision

1. Set the viewport to `width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover`.
2. Apply the viewport both statically on entry/fallback pages and dynamically through the shared bootstrap.
3. Change root interaction handling to `touch-action: pan-x pan-y`, allowing normal scrolling while excluding pinch zoom.
4. Keep the existing `#2b0d28` theme color and safe-area insets unchanged.
5. Add a Pixel 5 Playwright regression that sends an actual Chromium pinch gesture and verifies the visual viewport remains at scale 1.

## Scope

- Root and public entry metadata.
- GitHub Pages player-route fallback.
- Shared browser-surface bootstrap and stylesheet.
- Vitest contract and responsive Playwright regression.

## Risks

- Disabling page zoom reduces accessibility for users who rely on magnification. This is an explicit product requirement for the game-like mobile experience.
- Browser accessibility settings may override author zoom restrictions on some platforms; the implementation uses both viewport and touch-action controls for the strongest standards-supported behavior.

## Acceptance

- [ ] A two-finger pinch does not change `visualViewport.scale` in the mobile Chromium journey.
- [ ] The viewport contains both `maximum-scale=1` and `user-scalable=no`.
- [ ] The root interaction surface excludes `pinch-zoom` while retaining horizontal and vertical panning.
- [ ] Root, public entry and fallback pages declare the restrictive viewport statically.
- [ ] Shared bootstrap repairs or creates the exact restrictive viewport on all bootstrapped pages.
- [ ] Theme color and safe-area behavior remain unchanged.
- [ ] CI is green on the final branch head.

## Validation

Pending implementation and CI.

## Rollback

Revert this change to restore user-controlled pinch zoom. No database or deployment migration is involved.

## Delivery

- Branch: `agent/fix-disable-mobile-zoom`
- PR: pending.

## Status

In progress.
