# Player card radar and clean-route navigation fixes

## Request

Fix two production regressions on public player profiles:

1. The dynamic 1200x630 player PNG renders a pentagon and statistic labels that do not correspond to the web profile radar.
2. The header home/brand navigation resolves relative to `/player/<nick>` after the clean URL is restored, so it navigates to `/player/` instead of the application root.

## Evidence

- The browser radar uses five grid levels, axis lines, labels positioned around the pentagon, point markers, and the score order Precision, Regularity, Experience, Reliability, Impact.
- The Edge card uses only three grid levels, no axes or point markers, and places all statistic labels in a wrapped block below the chart.
- The Edge card calculates Impact from achievement points, while the browser calculates it from completed referrals and bonus attempts.
- `layout.js` creates relative navigation links while the document is initially served from `player.html`; `player.js` later calls `history.replaceState` with `/player/<nick>`. Relative anchors then resolve from the clean nested URL.

## Decision

- Keep the Edge card renderer isolated in the existing `player-share` function, but make its radar geometry, axis order, scoring, grid, labels, points, and player legend mirror `public/player-stats.js`.
- Remove the wrapped raw-stat label block from the generated card and position each axis label around the pentagon.
- Calculate card Impact with the same completed-referral and bonus-attempt formula as the browser.
- After restoring the clean player URL, rewrite shared chrome links against the application base returned by `Minuto106PlayerUI.appBaseUrl()`.
- Add static regression contracts, a clean-route browser navigation journey, and local Supabase generation of the overview PNG used for visual verification.

## Acceptance

- The PNG pentagon uses the same axis order and score formulas as the web radar.
- The PNG contains five grid levels, five axis lines, axis labels around the chart, series point markers, and a player legend.
- The generated card no longer renders the wrapped `LABEL VALUE` block below the pentagon.
- On `/player/<nick>` and nested player sections, the brand/home link and main navigation resolve to the application root and root pages, not `/player/`.
- The local Supabase integration persists and validates an overview player PNG.
- Vitest, syntax, ESLint, Knip, security, Supabase integration, desktop/mobile Playwright, public assets, and PR visual-evidence checks pass.

## Scope

- Public player-page navigation normalization.
- Dynamic player social-card radar rendering.
- Regression tests and generated visual evidence.
- No gameplay, captcha, timing, ranking, database schema, authentication, or write-API changes.

## Risks

- Social platforms cache image responses externally; the existing bounded cache headers remain unchanged.
- The Edge renderer has stricter SVG/text layout behavior than a browser; fixed safe-area coordinates and local PNG generation are required for verification.
- Link normalization must preserve external, protocol-relative, fragment, and non-navigation URLs.

## Tests

- Vitest source contracts for browser/Edge radar parity and clean-route link normalization.
- Playwright journey from a clean player URL that verifies and activates the application-root brand link.
- Local Supabase PNG signature, dimensions, cache policy, and persisted overview preview.

## Rollback

Revert the pull request. No migration or persistent data rollback is required.

## Delivery

- Branch: `agent/fix-player-card-radar`
- Base: `main`
- Normal pull request; no merge or deployment without explicit authorization.

## Status

Implementation in progress.