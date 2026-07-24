# Profile share preview

## Request

Investigate why sharing a player profile through WhatsApp produces only text and a link without an image preview, then correct the flow without exposing Supabase URLs.

## Evidence

- The in-app profile share action currently publishes the clean route `/106/player/<nick>`.
- GitHub Pages serves that clean route through the repository `404.html` fallback. In production the HTTP response remains `404`, even though client-side JavaScript redirects a browser to `player.html`.
- WhatsApp and other link unfurlers fetch the shared URL without executing the client-side redirect or `player.js` metadata updates, and commonly discard metadata from non-success responses.
- `public/player.html` is a real `200` document, but it currently has no static Open Graph or Twitter image metadata; all player metadata is inserted only after the profile API request in a browser.
- Therefore the previous clean-URL change made the visible URL trustworthy but selected a document that cannot be unfurled reliably by social crawlers.

## Decision

1. Keep all visible share links on the public GitHub Pages host.
2. Use the real `player.html?nick=<nick>[&section=<section>]` document for profile share payloads, because it returns `200` on GitHub Pages.
3. Keep pretty `/player/<nick>` routes for internal navigation and canonical indexing, but do not use a production `404` route as the social share target.
4. Add static Open Graph and Twitter large-image metadata to `player.html` using the repository-owned social preview, so crawlers receive an image without JavaScript.
5. Continue replacing metadata with the versioned player-specific PNG after the browser loads the public profile.
6. Keep the address bar on the previewable shell URL after loading, so browser-level sharing also uses the `200` document.
7. Make the local development server reproduce GitHub Pages by returning status `404` for clean-route fallback responses.
8. Cover route status, static metadata, share payloads and absence of Supabase hostnames.

## Scope

- `public/player.html`
- `public/player-ui.js`
- `public/player.js`
- `public/honours.js`
- `public/share-actions.js`
- `scripts/serve.mjs`
- player and sharing contract tests
- desktop/mobile Playwright regression coverage

## Acceptance

- Sharing a profile sends a `juanjogondev.github.io/106/player.html?nick=...` URL.
- The shared URL returns HTTP `200` and includes `og:image`, `og:image:secure_url`, `twitter:card`, `twitter:image` and `twitter:image:src` in the initial HTML.
- No profile share payload contains `supabase.co` or `/functions/`.
- Opening a player still renders the dynamic player-specific PNG and updates browser metadata after profile load.
- Internal player links and canonical URLs remain the existing pretty routes.
- The local clean-route fallback returns `404`, matching GitHub Pages instead of masking the crawler regression.
- Focused unit, contract and desktop/mobile browser tests pass.

## Risks

- Shared profile URLs are less decorative than the pretty route because they include `player.html` and query parameters. A reliable `200` preview takes precedence over a pretty URL that is an HTTP `404` to crawlers.
- GitHub Pages cannot server-render a player-specific Open Graph image. The initial crawler preview is the repository-owned game image; the browser page still uses the current versioned player PNG.
- Existing cached WhatsApp previews may require sharing the corrected URL once before the new preview is visible.

## Tests

- Node coverage verifies the share URL builder always returns the public `player.html` shell and preserves sections.
- Vitest contracts verify every profile sharing entry point uses the previewable URL, the static player shell contains complete image metadata and Supabase routes remain internal.
- Playwright verifies the clean route is a `404`, the shared shell is a `200`, its raw HTML contains image metadata, and the native share payload uses the shell on desktop and mobile.

## Rollback

Revert this branch. No database, migration, API, secret or persisted-data change is involved.

## Delivery

- Branch: `agent/fix-profile-share-preview`
- Base: `main`
- Normal pull request; no merge or deployment without explicit authorization.

## Status

In progress.
