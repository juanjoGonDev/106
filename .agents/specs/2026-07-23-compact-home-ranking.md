# Compact home ranking

## Request

Remove the global statistics strip below the Spain–Argentina score and reduce the height of the left home-page ranking. Keep each player's elapsed time on the same line as the nickname and flag, omit the visible country name, and preserve an accessible text alternative for the flag.

## Evidence

- `public/index.html` renders a three-cell `.stats-strip` immediately below the global score.
- `public/app.js` still writes those three values by element ID while rendering the score and leaderboard.
- The primary ranking renderer emits the country name and elapsed time inside a block-level `<small>` element.
- `public/ranking-enhancements.js` and `public/v4.js` can both replace the primary ranking markup, so all rendering paths must use the same compact contract.
- `public/styles.css` makes `.player small` block-level; `public/v11.css` is the latest cascade layer and owns ranking-link refinements.

## Decision

- Remove the visible `.stats-strip` section from the home page.
- Keep three hidden compatibility targets until the legacy statistics assignments are removed in a dedicated refactor; they have no layout, semantic, or accessibility exposure.
- Render only nickname, an accessible flag, and elapsed time in the player column.
- Use `role="img"`, `aria-label`, and `title` for CSS-background flags because they cannot use an HTML `alt` attribute.
- Override the home ranking player content to a single non-wrapping flex row, with nickname truncation rather than increasing row height.
- Add static regression coverage for all home ranking render paths and the removed visual section.

## Acceptance

- No `.stats-strip` section is present in `public/index.html`.
- The global score still renders without a JavaScript null dereference.
- Country names are not visibly rendered in home leaderboard rows.
- Every leaderboard flag has an accessible country label.
- Nickname, flag, and elapsed time remain on one line on desktop and mobile; long nicknames truncate.
- Existing profile links and difference metrics remain available.
- Syntax, lint, tests, visual-evidence validation, and CI pass.

## Scope

- Home page markup.
- Home ranking fallback and enhancement renderers.
- Latest ranking CSS overrides.
- Focused static regression tests.

## Risks

- The primary `app.js` renderer briefly emits legacy markup before the synchronous mutation observer enhancement runs. The latest CSS and enhancement normalize the final interactive row.
- Hidden compatibility targets are temporary technical debt; removing them requires changing the large legacy application module and should be handled separately with runtime coverage.

## Rollback

Revert the pull request. No data, API, migration, or deployment rollback is required.

## Validation

Pending implementation and CI.

## Delivery

- Branch: `agent/fix-compact-home-ranking`
- Base: `main`
- Pull request: pending
- Merge/deployment: not authorized

## Status

In progress.
