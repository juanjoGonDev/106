# Fix GitHub Pages runtime and mobile navigation

## Request

- Make the repository root serve the application instead of rendering the README when GitHub Pages is configured as `main/(root)`.
- Derive the public Supabase Edge Function URL automatically from repository variables instead of requiring a separately duplicated URL.
- Derive the public site URL automatically during GitHub Pages builds.
- Replace the overflowing mobile navigation with an accessible hamburger menu.
- Review and correct the failed post-merge deployment path.

## Evidence

- The committed `public/config.js` contains the `YOUR_PROJECT_REF` placeholder.
- `scripts/generate-config.mjs` only accepts `SUPABASE_FUNCTIONS_URL` and does not derive it from `SUPABASE_PROJECT_ID`.
- `.github/workflows/pages.yml` uploads `public/`, while the active branch publishing source serves the repository root.
- The shared header renders all navigation links inline at every viewport width.

## Decision

1. Add a root `index.html` that redirects branch-based Pages publishing to `public/` without duplicating application markup.
2. Generate `apiBaseUrl` from explicit `SUPABASE_FUNCTIONS_URL`, otherwise from `SUPABASE_PROJECT_ID`.
3. Generate `publicSiteUrl` from explicit `PUBLIC_SITE_URL`, otherwise the URL emitted by `actions/configure-pages`.
4. Configure Pages before generating runtime configuration.
5. Add an accessible hamburger button with `aria-expanded`, outside-click, Escape and navigation close behavior.
6. Add regression tests for runtime URL derivation, root fallback and mobile navigation structure.

## Acceptance

- Opening the branch-published repository root redirects to `./public/`.
- A Pages Actions build with only `SUPABASE_PROJECT_ID` produces a valid `https://<ref>.supabase.co/functions/v1/game-api` URL.
- A Pages Actions build with no explicit `PUBLIC_SITE_URL` uses the Pages base URL.
- Desktop navigation remains visible.
- At small widths, links are hidden behind a hamburger control and are keyboard accessible.
- Existing lint, Knip, Vitest, security and local Supabase checks pass.

## Validation

- `pnpm check`
- Pull-request Quality Gate
- Inspect generated `public/config.js` in tests for explicit and derived inputs.

## Delivery

- Branch: `agent/fix-pages-runtime-nav`
- PR to `main`

## Status

In progress.
