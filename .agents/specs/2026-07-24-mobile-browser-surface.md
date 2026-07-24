# Mobile browser surface

## Request

- Make the mobile web experience feel closer to an installed application.
- Prevent accidental page enlargement during normal interaction.
- Match the surrounding mobile browser interface to the red/blue dark background.

## Evidence

- Every deployable page declared `width=device-width,initial-scale=1` and a fixed black `theme-color`.
- The installed-web-app manifest also used black for both startup and browser chrome.
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

- [x] Application pages expose `viewport-fit=cover` after the shared bootstrap runs.
- [x] No deployable page uses `user-scalable=no` or `maximum-scale=1`.
- [x] Pinch zoom remains available and double-tap zoom is suppressed through `touch-action: manipulation`.
- [x] Safe-area insets protect content in browser and standalone modes.
- [x] Browser chrome and manifest theme color use `#2b0d28`.
- [x] Manifest startup background remains `#08090c`.
- [x] Vitest and desktop/mobile Playwright cover the behavior.
- [x] The implementation tree is green; delivery requires verification of the final documentation-only head.

## Validation

- Pull Request Quality Pipeline run `30080224555` passed syntax, Vitest, ESLint, Knip, dependency/security policy and local Supabase integration.
- Player Pages and Social Cards run `30080224561` passed frontend coverage, public-asset checks and every desktop Chrome / Pixel 5 Playwright journey.
- The browser test asserts the final viewport string, theme color, shared stylesheet and computed `touch-action` without a zoom-disabling token.
- Responsive evidence was generated in artifact `frontend-previews-30080224561`, digest `sha256:80b2bfa05f1b778761690eb3b42a04e62fdc1bdee7e36884bce5a3fea5ba9677`.
- Public Asset Audit run `30080224440` passed.
- Pull Request Visual Evidence run `30080533832` passed after the PR body documented the exact-head artifact and immutable matched layout baseline.

## Rollback

Revert the shared bootstrap, browser-surface stylesheet, metadata, tests and this specification. No data or deployment migration is required.

## Delivery

- Branch: `agent/feat-mobile-browser-surface`
- PR: `#24` — `feat(ui): integrate mobile browser surface`
- Merge/deploy: not performed; explicit user approval is required.

## Status

Complete. The final commit changes documentation only; the implementation behavior and validated browser artifact are unchanged.
