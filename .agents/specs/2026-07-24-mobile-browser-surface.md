# Mobile browser surface

## Request

- Make the mobile web experience feel closer to an installed application.
- Prevent accidental page enlargement during normal interaction.
- Match the surrounding mobile browser interface to the red/blue dark background.

## Evidence

- Every deployable page currently declares `width=device-width,initial-scale=1` and a fixed black `theme-color`.
- The installed-web-app manifest also uses black for both startup and browser chrome.
- The page background is a red and blue split radial composition over `#08090c`.
- The existing text input is already larger than 16 CSS pixels, so iOS focus zoom does not need a global zoom lock.
- `user-scalable=no` or `maximum-scale=1` would remove pinch zoom and create an accessibility regression.

## Decision

1. Keep pinch zoom available.
2. Use `touch-action: manipulation` to remove accidental double-tap zoom while preserving panning and pinch zoom.
3. Normalize the viewport to `width=device-width,initial-scale=1,viewport-fit=cover` from the shared head bootstrap.
4. Add safe-area padding for notches, rounded corners and installed standalone mode.
5. Use one solid blended red/blue browser-chrome color, `#2b0d28`, because browser theme metadata cannot render the page gradient.
6. Keep `#08090c` as the manifest startup background to avoid a bright launch flash.
7. Cover the root redirect and GitHub Pages fallback statically; cover application pages through the shared head bootstrap.

## Scope

- Shared head bootstrap.
- Mobile browser-surface stylesheet.
- Web app manifest.
- Root redirect and GitHub Pages fallback metadata.
- Vitest contracts and desktop/mobile Playwright assertions.

## Risks

- Mobile browsers differ in how much surrounding UI they tint from `theme-color`.
- `viewport-fit=cover` can expose content beneath device cutouts unless safe-area insets are applied.
- A fully disabled zoom gesture would look more app-like but would reduce accessibility; it is intentionally out of scope.

## Acceptance

- [ ] Application pages expose `viewport-fit=cover` after the shared bootstrap runs.
- [ ] No deployable page uses `user-scalable=no` or `maximum-scale=1`.
- [ ] Pinch zoom remains available and double-tap zoom is suppressed through `touch-action: manipulation`.
- [ ] Safe-area insets protect content in browser and standalone modes.
- [ ] Browser chrome and manifest theme color use `#2b0d28`.
- [ ] Manifest startup background remains `#08090c`.
- [ ] Vitest and desktop/mobile Playwright cover the behavior.
- [ ] CI is green on the final branch head.

## Validation

Pending implementation and CI.

## Rollback

Revert the shared bootstrap, browser-surface stylesheet, metadata, tests and this specification. No data or deployment migration is required.

## Delivery

- Branch: `agent/feat-mobile-browser-surface`
- PR: pending.

## Status

In progress.
