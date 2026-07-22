# Mobile gameplay viewport and account-link simplification

## Request

Replace the large account-protection form on the game screen with one accessible link to the account/profile page. Fix the mobile transition from the numbered-ball verification to gameplay so the timer is visible without manual scrolling or loss of concentration.

## Evidence

- The deployed game keeps all three panels in one CSS grid area while hiding inactive panels with `visibility`, so the tallest setup panel determines the game-card height.
- Players press the start action near the bottom of that tall setup panel. After the full-screen verification closes, the browser preserves that scroll position while the timer is located near the top of the playing panel.
- The visual-check stability rules exist in `v9.css`, but the game page does not load that stylesheet.
- The home screen duplicates account key copy/import controls already available on `cuenta.html`.

## Decision

- Remove inactive game panels from layout participation and let the active panel determine card height.
- Install a viewport controller before `app.js`; when the playing panel becomes active, synchronously center the timer stage before the next paint, then verify the position for two animation frames to absorb mobile visual-viewport changes.
- Use `visualViewport` when available, clamp against document scroll limits, avoid smooth scrolling, and move programmatic focus to the playing region without causing a second scroll.
- Keep captcha progress and the explicit start button in the same reserved grid row, and make the overlay fit portrait, landscape and short-height viewports.
- Replace the account card on the game page with a single descriptive link to `cuenta.html`; retain all key management on that dedicated page.

## Acceptance criteria

- The game page exposes one keyboard-focusable account/profile link and no account key copy/import controls.
- Inactive setup/result panels do not affect the playing card height.
- Activating gameplay centers the timer stage before the first rendered timer frame.
- Centering uses the visual viewport, handles clamping at document boundaries and does not animate.
- The captcha panel keeps a stable action row and remains usable on small portrait, landscape, tablet and desktop dimensions.
- Automated tests cover representative viewport matrices, source-order guarantees, accessible markup and CSS layout contracts.
- Build, syntax, Vitest, ESLint, Knip, security and Supabase integration pass.

## Risks

- Aggressive recentering could fight intentional user scrolling. Mitigation: run only on playing activation and a bounded two-frame stabilization sequence.
- Mobile browser chrome can change viewport height while scrolling. Mitigation: calculate from `visualViewport` and repeat after animation frames.
- Programmatic focus can trigger a second browser scroll. Mitigation: use `focus({ preventScroll: true })` after positioning.

## Rollback

Revert the pull request. No database or API changes are involved.

## Delivery

- Branch: `agent/fix-mobile-game-viewport-account-link`
- Base: deployed `main` commit `4a3cff093226540a128d4f86ac9eda26cf2995d7`.
- Normal PR to `main`; no merge or deployment without explicit approval.

## Status

Implementation in progress.
