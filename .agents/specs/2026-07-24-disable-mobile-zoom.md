# Disable mobile page zoom

## Request

- Prevent users from enlarging the game page with a two-finger pinch gesture on mobile.
- Preserve the existing browser theme color and safe-area treatment.
- Correct the behavior merged in PR #24, which only reduced accidental double-tap zoom.

## Evidence

- The merged viewport was `width=device-width,initial-scale=1,viewport-fit=cover`; it had no maximum scale or user-scalable restriction.
- The shared browser stylesheet used `touch-action: manipulation`, which explicitly permits pinch zoom.
- The previous test asserted that pinch zoom remained available, so CI protected the opposite behavior from the requested one.
- Safari on iOS ignores viewport scale restrictions; WebKit points to `touch-action` for per-element zoom control, so viewport metadata alone is insufficient.

## Decision

1. Set the viewport to `width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover`.
2. Apply the viewport statically on the root redirect and GitHub Pages fallback and dynamically through the shared bootstrap on application pages.
3. Change root interaction handling to `touch-action: pan-x pan-y`, allowing normal one-finger scrolling while excluding pinch zoom.
4. Add non-passive multi-touch and WebKit `gesture*` cancellation as an iOS fallback.
5. Keep the existing `#2b0d28` theme color and safe-area insets unchanged.
6. Add a Pixel 5 Playwright regression that sends an actual Chromium pinch gesture and verifies the visual viewport remains at scale 1.

## Scope

- Root redirect metadata.
- GitHub Pages player-route fallback.
- Shared browser-surface bootstrap and stylesheet.
- Vitest contract and responsive Playwright regression.

## Risks

- Disabling page zoom reduces accessibility for users who rely on magnification. This is an explicit product requirement for the game-like mobile experience.
- Browser accessibility settings may override author zoom restrictions on some platforms; the implementation uses viewport, touch-action and event cancellation for the strongest available behavior.

## Acceptance

- [x] A two-finger pinch does not change `visualViewport.scale` in the mobile Chromium journey.
- [x] The viewport contains both `maximum-scale=1` and `user-scalable=no`.
- [x] The root interaction surface excludes `pinch-zoom` while retaining horizontal and vertical panning.
- [x] Root redirect and fallback pages declare the restrictive viewport statically.
- [x] Shared bootstrap repairs or creates the exact restrictive viewport on all bootstrapped application pages.
- [x] Non-passive multi-touch and WebKit gesture fallbacks cover iOS behavior.
- [x] Theme color and safe-area behavior remain unchanged.
- [x] The implementation tree is green; the final documentation-only head requires verification.

## Validation

- Player Pages and Social Cards run `30082487734` passed every desktop Chrome and Pixel 5 Playwright journey.
- The Pixel 5 test sent `Input.synthesizePinchGesture` with scale factor 2 and verified `visualViewport.scale` remained exactly `1`.
- Pull Request Quality Pipeline run `30082487780` passed build, syntax, Vitest, ESLint, Knip, dependency/security policy, local Supabase integration and the final quality gate.
- Public Asset Audit run `30082487822` passed.
- Pull Request Visual Evidence run `30082487691` passed.
- Implementation head: `77566236e79acf765d52b53e1a48dd00022530cb`.

## Rollback

Revert this change to restore user-controlled pinch zoom. No database or deployment migration is involved.

## Delivery

- Branch: `agent/fix-disable-mobile-zoom`
- PR: `#25` — `fix(ui): disable mobile page zoom`
- Merge/deploy: not performed; explicit user approval is required.

## Status

Complete. This final commit changes documentation only; the validated browser behavior is unchanged.
