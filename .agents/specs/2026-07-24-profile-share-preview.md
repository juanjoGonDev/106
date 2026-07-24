# Profile share preview

## Request

Investigate why sharing a player profile through WhatsApp produces only text and a link without an image preview, then correct the flow without exposing Supabase URLs.

## Evidence

- The in-app profile share action published the clean route `/106/player/<nick>`.
- GitHub Pages serves that clean route through the repository `404.html` fallback. The HTTP response remains `404`, even though client-side JavaScript redirects a browser to `player.html`.
- WhatsApp and other link unfurlers fetch the shared URL without executing the client-side redirect or the later `player.js` metadata updates, so the clean route did not expose usable image metadata.
- `public/player.html` is a real `200` document, but it previously had no static Open Graph or Twitter image metadata; player metadata was inserted only after the profile API request in a browser.
- During final CI validation, GitHub's advisory database began rejecting the existing transitive `postcss@8.5.16` through `vite`/`vitest` for `GHSA-r28c-9q8g-f849`. The advisory requires `postcss>=8.5.18`.

## Decision

1. Keep all visible share links on the public GitHub Pages host.
2. Use the real `player.html?nick=<nick>[&section=<section>]` document for profile share payloads because it returns `200` on GitHub Pages.
3. Keep pretty `/player/<nick>` routes for internal navigation, the browser address bar and canonical indexing, but do not use a production `404` route as the explicit social share target.
4. Add static Open Graph and Twitter large-image metadata to `player.html` using the repository-owned social preview, so crawlers receive an image without JavaScript.
5. Continue replacing browser metadata with the versioned player-specific PNG after the public profile loads.
6. Make the local development server reproduce GitHub Pages by returning status `404` for clean-route fallback responses.
7. Cover route status, static metadata, share payloads and absence of Supabase hostnames.
8. Converge the transitive PostCSS graph on exact `8.5.19`, the first validated patched version selected for this repository. Scope the release-age bypass to `postcss@8.5.19` only and document it as a temporary security exception.
9. Preserve dependency-audit JSON as a CI artifact before enforcing a failed audit, so future advisories remain diagnosable without weakening the gate.

## Scope

- `public/player.html`
- `public/player-ui.js`
- `public/player.js`
- `public/honours.js`
- `public/share-actions.js`
- `scripts/serve.mjs`
- `pnpm-workspace.yaml`
- `pnpm-lock.yaml`
- `.github/workflows/ci.yml`
- player and sharing contract tests
- desktop/mobile Playwright regression coverage

## Acceptance

- Sharing a profile sends a `juanjogondev.github.io/106/player.html?nick=...` URL.
- The shared URL returns HTTP `200` and includes `og:image`, `og:image:secure_url`, `twitter:card`, `twitter:image` and `twitter:image:src` in the initial HTML.
- No profile share payload contains `supabase.co` or `/functions/`.
- Opening a player still renders the dynamic player-specific PNG and updates browser metadata after profile load.
- Internal player links, browser navigation and canonical URLs remain the existing pretty routes.
- The local clean-route fallback returns `404`, matching GitHub Pages instead of masking the crawler regression.
- Focused unit, contract and desktop/mobile browser tests pass.
- The exact installed PostCSS version is patched and `pnpm audit --audit-level=high` reports zero vulnerabilities.
- Audit failures upload machine-readable diagnostics before the quality gate fails.

## Risks

- Shared profile URLs are less decorative than the pretty route because they include `player.html` and query parameters. A reliable `200` preview takes precedence over a pretty URL that is an HTTP `404` to crawlers.
- GitHub Pages cannot server-render a player-specific Open Graph image. The initial crawler preview is the repository-owned game image; the browser page still uses the current versioned player PNG.
- Existing cached WhatsApp previews may require sharing the corrected URL once before the new preview is visible.
- `postcss@8.5.19` was newer than the repository's strict maturity window when the advisory appeared. The exception is exact-version scoped, justified by a high-severity advisory, and must be removed after the normal maturity window.

## Tests

- Node coverage verifies the share URL builder always returns the public `player.html` shell and preserves sections.
- Vitest contracts verify every profile sharing entry point uses the previewable URL, the static player shell contains complete image metadata and Supabase routes remain internal.
- Playwright verifies the clean route is a `404`, the shared shell is a `200`, its raw HTML contains image metadata, and the native share payload uses the shell on desktop and mobile while the page keeps canonical navigation.
- A clean pnpm 11.15.1 lockfile regeneration verified the PostCSS override against supply-chain policy and produced an audit report with zero info, low, moderate, high or critical vulnerabilities.

## Validation

- Static application build, syntax and public-asset checks passed before delivery.
- Vitest, ESLint and Knip passed on the functional implementation.
- Desktop and mobile Playwright player/share journeys passed.
- Local Supabase API integration passed.
- Generated dependency graph resolved `postcss@8.5.19` and passed `pnpm audit --audit-level=high` with zero vulnerabilities.
- Final branch CI is authoritative for merge readiness.

## Rollback

Revert this branch. No database, migration, API, secret or persisted-data change is involved.

## Delivery

- Branch: `agent/fix-profile-share-preview`
- Pull request: `#29`
- Base: `main`
- Normal pull request; no merge or deployment without explicit authorization.

## Status

Completed. Awaiting final CI confirmation before merge readiness.
