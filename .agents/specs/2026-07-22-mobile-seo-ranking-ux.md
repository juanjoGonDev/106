# Mobile, SEO, ranking and UX fixes

## Request

- Restore gameplay on mobile when the generated public Supabase configuration is missing or stale.
- Prepare the public entry points for search engines and rich previews in WhatsApp and social networks.
- Fix the ranking page so the complete verified ranking is available instead of repeating the top-ten response.
- Make interactive controls visually identifiable and keyboard accessible.
- Keep the final stop control in a stable position.
- Avoid layout shifts between the visual verification and the active game.
- Restart the numbered-football sequence from the first ball whenever the player makes an invalid selection.

## Evidence

- `public/config.js` on `main` still contains `YOUR_PROJECT_REF`, so production can render the configuration warning and fail before a game request is sent.
- The branch-published root page redirects to `public/` but does not expose the same search/social metadata as the game page.
- Open Graph currently references an SVG under `/106/assets/`, while branch publishing serves the asset under `/106/public/assets/` and several social crawlers require a raster image.
- `ranking.js` calls `stats`, whose database function limits the leaderboard to ten entries, despite the page being presented as the complete classification.
- Ranking rows use `tabindex` without an Enter/Space activation handler.
- The stop control uses server-provided random coordinates and an absolutely positioned pad.
- An incorrect football press keeps partial progress instead of resetting the sequence.

## Decision

- Keep the public Supabase project reference as a non-secret deterministic fallback in the generated runtime configuration.
- Publish equivalent canonical, robots, Open Graph, Twitter Card and structured-data metadata at the root redirect and game entry point.
- Add a 1200×630 PNG generated from the repository-owned rivalry artwork and use it for social previews.
- Add a bounded, cursor-paginated ranking RPC exposed through the Edge Function.
- Use semantic buttons for ranking entries and a separate load-more action.
- Fix the final stop control at the visual centre and redefine the pointer-only challenge wrapper to use a fixed target.
- Preserve anti-automation validation through the human proof, trusted pointer event, timing checks and server validation rather than moving the final control.
- Lock the game-card block size while verification and gameplay transition, and compensate scrollbar removal while the verification overlay is open.
- Reset clicks, progress and timing to ball 1 after every invalid football press.

## Acceptance

- A production build without repository variables still generates `https://imtitjwgiemlaabpioed.supabase.co/functions/v1/game-api`.
- Mobile setup enables the start action once nick and team are valid.
- Root and public game pages expose indexable canonical metadata and a valid 1200×630 PNG preview.
- `robots.txt` and `sitemap.xml` are available in branch and workflow publishing modes.
- Ranking supports more than ten entries, preserves stable ranks and loads additional pages without duplicates.
- Ranking entries work with pointer, Enter and Space through native button semantics.
- All enabled buttons, links and interactive ranking rows show pointer feedback; disabled controls show `not-allowed`.
- The stop control remains centred and does not change position between attempts.
- The game card does not collapse or jump when the verification overlay closes.
- A wrong football press clears all prior progress and restarts at ball 1.
- Existing unit, security, lint, Knip and local Supabase integration checks pass.

## Risks

- The public project reference is intentionally visible; it is not a credential and does not grant database access.
- Social platforms cache preview metadata, so an old card can remain visible until their cache refreshes.
- Adding paginated ranking reads increases public read traffic; page size and offset are bounded server-side.
- Fixed control coordinates make repeated pointer locations normal, so the server wrapper normalizes only the fixed target while retaining timing, pointer-type and movement telemetry.

## Rollback

- Revert the pull request.
- The ranking and fixed-control migration is additive/redefining only. Do not edit it after production application; use a corrective migration if rollback is required.
- The previous SVG social asset remains available as a fallback.

## Delivery

- Branch: `agent/fix-mobile-seo-ranking-ux`.
- Normal pull request to `main`.
- No merge or production deployment without explicit approval.

## Status

In progress.
