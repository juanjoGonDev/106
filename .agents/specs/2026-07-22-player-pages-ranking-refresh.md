# Player pages, ranking consistency, and live honours

## Request

Fix inconsistent team flags, refresh daily awards after every completed attempt, make precision/trophy/achievement rankings navigate to public player profiles, correct cramped honour dates, provide shareable player sections, generate a dynamic social card from a reusable image template, and audit pointer cursors. Cover new behavior with unit, integration, responsive browser, and Edge Function tests.

## Evidence

- The game leaderboard renders CSS flags, while `ranking.js` writes only the country name for precision and receives no team for trophy/achievement rows.
- `v3.js` loads daily awards only during initialization. Finishing an attempt refreshes the main stats but not the award surface.
- Public profiles are duplicated between `ranking.js`, `profile-overlay.js`, and `v3.js`, with different links and markup.
- Honour titles, descriptions, and dates share inline text containers, producing cramped dates.
- GitHub Pages cannot emit player-specific Open Graph metadata for arbitrary static paths.

## Decision

- Introduce one shared player UI contract for escaping, teams, flags, clean routes, section parsing, share endpoints, and PNG card endpoints.
- Add a dedicated player page with overview, achievements, and trophies sections. Use `/player/<nick>`, `/player/<nick>/achievements`, and `/player/<nick>/trophies` as visible routes, with a Pages `404.html` shell for direct clean-route requests.
- Replace modal interception with navigable player links in all ranking surfaces.
- Extend honour ranking, public profile, and daily award RPC payloads with a deterministic latest verified global team.
- Observe successful `finish` responses and refresh daily awards and progressive profile honours without reloading the document.
- Add a public `player-share` Edge Function. HTML requests return player-specific Open Graph metadata; image requests render a real 1200x630 PNG by placing live player data over the reusable `player-card-template.svg` design through the pinned `@vercel/og` Edge renderer.
- Keep the runtime image generator isolated to the Edge Function. Browser tests use an exact Playwright release in CI without adding a mutable application dependency.

## Acceptance

- Every precision, trophy, achievement, and daily-award player entry has a visible flag and a real link.
- Completing an attempt refreshes the daily award card without reloading the document.
- Player routes render overview, achievements, and trophies on desktop and mobile without horizontal overflow.
- Honour dates use dedicated `time` elements with explicit layout spacing.
- Share actions use the dynamic player-share URL and its `og:image` points to an `image/png` response generated from the committed template.
- All anchors and enabled interactive controls expose a pointer cursor.
- New pure player-route/team helpers maintain 100% lines, functions, and branches.
- Vitest, syntax, ESLint, Knip, security, local Supabase integration, and Playwright desktop/mobile flows pass.

## Scope

- Public web UI, read-only profile/ranking RPCs, one public Edge Function, CI, and tests.
- No change to attempt limits, timing, captcha, account ownership, or anti-cheat behavior.

## Risks

- Social networks cache Open Graph pages and images outside application control; the endpoint uses bounded cache headers and stable URLs.
- `@vercel/og` and React are pinned inside the Edge Function, following Supabase's documented Deno/npm OG-image pattern.
- The public share endpoint exposes only data already returned by `public-profile`.

## Tests

- Pure helper coverage: 100% lines, functions, and branches.
- Static contracts for flags, links, event refresh, separated dates, template use, HTML metadata, PNG response, and cache policy.
- Local Supabase journey for team payloads and player-share HTML/PNG routes.
- Playwright Chromium projects for desktop and mobile player navigation, responsive layout, links, tabs, and award refresh.

## Rollback

Revert the pull request. The SQL migration only replaces read-only functions and can be superseded by a forward corrective migration.

## Delivery

- Branch: `agent/feat-player-pages-ranking-refresh`
- Base: deployed `main` after PR #13.
- Normal PR to `main`; no merge or deployment without explicit approval.

## Status

Implementation in progress.