# Player pages, ranking consistency, and live honours

## Request

Fix inconsistent team flags, refresh daily awards after every completed attempt, make precision/trophy/achievement rankings navigate to public player profiles, correct cramped honour dates, provide shareable player sections, generate a dynamic social card, and audit pointer cursors. Cover new behavior with unit, integration, responsive browser, and Edge Function tests.

## Evidence

- The game leaderboard renders CSS flags, while `ranking.js` writes only the country name for precision and receives no team for trophy/achievement rows.
- `v3.js` loads daily awards only during initialization. Finishing an attempt refreshes the main stats but not the award surface.
- Public profiles are duplicated between `ranking.js`, `profile-overlay.js`, and `v3.js`, with different links and markup.
- Honour titles, descriptions, and dates share inline text containers, producing cramped dates.
- GitHub Pages cannot emit player-specific Open Graph metadata for arbitrary static paths.

## Decision

- Introduce one shared player UI contract for escaping, teams, flags, clean routes, section parsing, and share endpoints.
- Add a dedicated player page with overview, achievements, and trophies sections. Use `/player/<nick>`, `/player/<nick>/achievements`, and `/player/<nick>/trophies` as visible routes, with a Pages fallback redirect to the static shell.
- Replace modal interception with navigable player links in all ranking surfaces.
- Extend honour ranking and daily award RPC payloads with a deterministic latest verified global team.
- Refresh daily awards through a fetch observer after each successful finish and dispatch a refresh event for progressive profile honours.
- Add a public `player-share` Edge Function. It returns player-specific HTML metadata and a structured 1200x630 SVG social card containing the stats pentagon, precision metrics, trophies, achievements, and team identity.
- Keep the repository dependency graph unchanged. Browser tests install an exact Playwright runtime in an isolated CI workspace.

## Acceptance

- Every precision, trophy, achievement, and daily-award player entry has a visible flag and a real link.
- Completing an attempt refreshes the daily award card without reloading the document.
- Player routes render overview, achievements, and trophies on desktop and mobile without horizontal overflow.
- Honour dates use a dedicated time element with explicit spacing.
- Share actions use the dynamic player-share URL and the endpoint emits player-specific metadata and image content.
- All anchors and enabled interactive controls expose a pointer cursor.
- New pure player-route/team helpers maintain 100% lines, functions, and branches.
- Vitest, syntax, ESLint, Knip, security, local Supabase integration, and Playwright desktop/mobile flows pass.

## Risks

- GitHub Pages clean paths are resolved through `404.html`; direct requests briefly redirect to the static player shell.
- SVG social images are standards-compliant but individual third-party preview caches remain outside repository control.
- The public share endpoint exposes only data already available through `public-profile`.

## Rollback

Revert the pull request. The SQL migration only replaces read-only functions and can be superseded by a forward corrective migration.

## Delivery

- Branch: `agent/feat-player-pages-ranking-refresh`
- Base: deployed `main` after PR #13.
- Normal PR to `main`; no merge or deployment without explicit approval.

## Status

Implementation in progress.
