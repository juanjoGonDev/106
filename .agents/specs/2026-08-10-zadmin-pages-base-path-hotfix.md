# Zadmin GitHub Pages base-path hotfix

## Request

Fix the production `/zadmin/` page after deployment to GitHub Pages showed unstyled HTML and 404s for `styles.css`, zadmin CSS/JS, password visibility and `config.js`, while local development remained correct.

## Evidence

- Production is hosted from the repository project path (`/106/`), not the origin root.
- The merged zadmin document currently references route assets with origin-root absolute URLs such as `/styles.css`, `/config.js` and `/zadmin/zadmin.js`.
- Those URLs resolve correctly when local development serves the application at `http://127.0.0.1:3000/`, but they resolve outside the repository project path on GitHub Pages.
- The production browser therefore requests origin-root assets and receives 404 responses, leaving the page unstyled and preventing the zadmin module from mounting.
- The previous slashless regression was real: relative assets need a canonical trailing-slash document URL locally.

## Decision

- Zadmin document-owned asset references are relative to `public/zadmin/index.html`, not origin-root absolute and not hard-coded to `/106/`.
- Shared assets use `../...`; zadmin-owned assets use `./...`. This supports root hosting, GitHub Pages project hosting and other future base paths from the same artifact.
- The local static server canonicalizes `GET`/`HEAD /zadmin` to `/zadmin/` before resolving files so relative assets remain correct without requiring every asset to be origin-root absolute.
- The login form fallback remains `POST` with credential inputs lacking serialization names. Its action is document-relative so it does not escape a project base path.
- Tests must verify both local slashless canonicalization and URL resolution under a representative project base URL (`https://example.test/106/zadmin/`).
- Do not hard-code the repository name into application assets. The hosting base is deployment context, not application domain logic.

## Acceptance

- GitHub Pages-style `/106/zadmin/` resolves every zadmin/shared asset under `/106/`; none resolve to the origin root.
- Local `/zadmin` redirects to `/zadmin/` and the existing browser login regression remains green.
- Enter login still does not put credentials in the query string.
- A script-loading failure cannot serialize username/password into the URL.
- Existing zadmin authentication, session, ban, audit and integrity behavior is unchanged.
- Desktop/mobile visual evidence remains professional and unchanged apart from restoring the intended styles in project-path hosting.

## Checks

- Vitest security/static URL-resolution regression.
- Playwright slashless zadmin entry regression.
- Build, ESLint, Knip, unit/security, Supabase, Desktop/Mobile browser and platform-evidence workflows.
- Inspect final visual evidence generated from the final head.

## Delivery

- Branch: `agent/fix-zadmin-pages-base-path`
- New non-draft PR to `main`.
- No merge or production deployment without explicit authorization.

## Rollback

Revert the application/server/test changes. No schema, migration or production data change is involved.

## Status

In progress.
