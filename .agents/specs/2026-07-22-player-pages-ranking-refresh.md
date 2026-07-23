# Player pages, ranking consistency, and live honours

## Request

Fix inconsistent team flags, refresh daily awards after every completed attempt, make precision/trophy/achievement rankings navigate to public player profiles, correct cramped honour dates, provide shareable player sections, generate a dynamic social card from a reusable image template, and audit pointer cursors. Cover new behavior with unit, integration, responsive browser, and Edge Function tests.

## Evidence

- The game leaderboard rendered CSS flags, while `ranking.js` wrote only the country name for precision and received no team for trophy/achievement rows.
- `v3.js` loaded daily awards only during initialization. Finishing an attempt refreshed the main stats but not the award surface.
- Public profiles were duplicated between `ranking.js`, `profile-overlay.js`, and `v3.js`, with different links and markup.
- Honour titles, descriptions, and dates shared inline text containers, producing cramped dates.
- GitHub Pages cannot emit player-specific Open Graph metadata for arbitrary static paths.
- Browser validation reproduced the intermittent flag defect: `v4.js` issued a delayed fallback stats request and could overwrite the correct `app.js` leaderboard with legacy markup that omitted flags and links.
- Local Edge validation showed that `request.url` can expose an internal runtime hostname behind the Supabase gateway, so social URLs must be reconstructed from forwarded public headers.

## Decision

- Introduce one shared player UI contract for escaping, teams, flags, clean routes, section parsing, share endpoints, and PNG card endpoints.
- Add a dedicated player page with overview, achievements, and trophies sections. Use `/player/<nick>`, `/player/<nick>/achievements`, and `/player/<nick>/trophies` as visible routes, with a Pages `404.html` shell for direct clean-route requests.
- Replace modal interception with navigable player links in all ranking surfaces.
- Make both primary and delayed fallback ranking renderers use the same flag/link contract.
- Extend honour ranking, public profile, and daily award RPC payloads with a deterministic latest verified global team.
- Observe successful `finish` responses and refresh daily awards and progressive profile honours without reloading the document.
- Add a public `player-share` Edge Function. HTML requests return player-specific Open Graph metadata; image requests render a real 1200x630 PNG by placing live player data over the reusable `player-card-template.svg` design through the pinned `@vercel/og` Edge renderer.
- Reconstruct public share and image URLs from forwarded proxy headers, with explicit public configuration and safe Supabase fallbacks.
- Keep the runtime image generator isolated to the Edge Function. Browser tests use an exact Playwright release in CI without adding a mutable application dependency.

## Acceptance

- Every precision, trophy, achievement, and daily-award player entry has a team flag and a real link.
- Completing an attempt refreshes the daily award card without reloading the document.
- Player routes render overview, achievements, and trophies on desktop and mobile without horizontal overflow.
- Honour dates use dedicated `time` elements with explicit layout spacing.
- Share actions use the dynamic player-share URL and its `og:image` points to an `image/png` response generated from the committed template.
- Public social metadata never exposes the Edge runtime's internal hostname.
- All anchors and enabled interactive controls expose a pointer cursor.
- New pure player-route/team and finish-observer modules maintain 100% lines, functions, and branches.
- Vitest, syntax, ESLint, Knip, security, local Supabase integration, and Playwright desktop/mobile flows pass.

## Scope

- Public web UI, read-only profile/ranking RPCs, one public Edge Function, CI, and tests.
- No change to attempt limits, timing, captcha, account ownership, or anti-cheat behavior.

## Risks

- Social networks cache Open Graph pages and images outside application control; the endpoint uses bounded cache headers and stable URLs.
- `@vercel/og` and React are pinned inside the Edge Function, following Supabase's documented Deno/npm OG-image pattern.
- The public share endpoint exposes only data already returned by `public-profile`.
- The game sidebar is intentionally hidden at mobile breakpoints; mobile tests require the same flag/link data in the DOM and validate visible flags through the dedicated ranking and player pages.

## Validation

- Player Pages and Social Cards run `29962691742` passed both required jobs.
- Native Node V8 coverage passed at 100% lines, 100% functions, and 100% branches for `public/player-ui.js`.
- Native Node V8 coverage passed at 100% lines, 100% functions, and 100% branches for `public/attempt-refresh.js`.
- Playwright 1.60.0 passed six Chrome journeys across desktop and Pixel 5 mobile projects, covering clean routes, all ranking types, visible flags, profile links, cursor behavior, semantic date spacing, no horizontal overflow, and live award refresh after `finish`.
- Pull Request Quality Pipeline run `29962691747` passed build and syntax validation, Vitest, ESLint, Knip, dependency/security policy, local Supabase reconstruction, Edge Functions, generated PNG signature/content type/cache checks, and the final Quality Gate.
- The local Supabase journey validated deterministic team payloads, player-specific HTML metadata, proxy-safe `og:image` URLs, real PNG generation over the committed template, and bounded cache headers.

## Tests

- Pure helper and observer coverage: 100% lines, functions, and branches.
- Static contracts for flags, links, fallback races, event refresh, separated dates, template use, HTML metadata, proxy-safe PNG URLs, PNG response, and cache policy.
- Local Supabase journey for team payloads and player-share HTML/PNG routes.
- Playwright Chrome projects for desktop and mobile player navigation, responsive layout, links, tabs, and award refresh.

## Rollback

Revert the pull request. The SQL migration only replaces read-only functions and can be superseded by a forward corrective migration.

## Delivery

- Branch: `agent/feat-player-pages-ranking-refresh`
- Base: deployed `main` after PR #13.
- Pull request: `#14`.
- Normal PR to `main`; no merge or deployment without explicit approval.

## Status

Implementation complete and validated. Awaiting explicit merge authorization.