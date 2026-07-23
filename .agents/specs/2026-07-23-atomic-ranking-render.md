# Atomic home ranking render

## Request

Prevent the home ranking from intermittently rendering incomplete fields: an isolated `s` instead of the complete elapsed time or a missing country flag. The ranking must remain hidden while any required row field is incomplete and become visible only after rank, team, nickname, elapsed time, difference, and the final flag representation are available.

## Evidence

- The home page has multiple asynchronous ranking producers: the main `stats` renderer and the `v4.js` fallback renderer.
- `public/home-ranking-density.js` normalizes the DOM after those producers mutate `#leaderboard`.
- The previous normalizer accepted any non-empty existing `.ranking-time` text without validating that it contained a numeric elapsed value, so an intermediate `s` could be treated as final content.
- The previous `MutationObserver` watched only direct child-list replacements. It did not retry when a partially created row later received missing text or visual identity content inside the row subtree.
- Ranking flags were converted to external SVG `<img>` elements with asynchronous decoding. The row became visible without proving that the image had painted, creating another independent render race.
- The supplied screenshots show the same ranking structure alternating between complete times and unit-only times, and between present and missing flags.

## Decision

- Treat a row as renderable only when all required data fields are present: anchor, player container, supported team, nickname, numeric rank, numeric difference, and a numeric elapsed time followed by seconds.
- Parse and normalize elapsed values to exactly three decimals. A standalone `s`, `NaN s`, an em dash, or any other incomplete value is invalid.
- Validate every visible row before modifying any row. This provides an all-or-nothing render gate for the ranking.
- Set `aria-busy="true"` and hide non-empty ranking rows while any row remains incomplete.
- Observe child, subtree, and character-data mutations so the normalizer retries automatically when delayed data arrives.
- Render ranking flags as the existing CSS flag primitives instead of asynchronously decoded image files. Each flag is created synchronously with `role="img"` and an accessible country name.
- Revalidate completed rows. If a flag or another normalized field disappears, rebuild that row rather than trusting a stale ready marker.
- Remove the now-unused ranking SVG flag assets so the deployable asset graph remains clean.

## Acceptance

- A row containing only `s` is never visible.
- The leaderboard remains busy and its non-empty rows remain visually hidden while any required field is incomplete.
- When the missing elapsed value changes to a valid value such as `10.604 s`, the complete row is normalized and shown automatically.
- Valid elapsed values render as `10.604s`, `9.902s`, and equivalent three-decimal values.
- Spain and Argentina flags render synchronously without an image download or decode dependency.
- Every normalized flag has `role="img"`, an accessible country label, and the expected CSS gradient.
- If a flag is removed after initial rendering, the observer restores it automatically.
- Existing rank, nickname, difference, profile link, keyboard focus, spacing, desktop placement, and mobile awards behavior remain unchanged.
- No API, database, scoring, authentication, or persistence changes are introduced.

## Scope

- `public/home-ranking-density.js`
- `public/v12.css`
- Removal of obsolete ranking SVG assets
- Home ranking unit/source-contract tests
- Home ranking Playwright regression coverage

## Risks

- If the API or another renderer permanently omits a required row field, the ranking remains in its loading state rather than exposing corrupt content. This is intentional and safer than presenting incorrect data.
- The observer now watches the leaderboard subtree. Completed rows are marked and structurally revalidated to prevent mutation loops while repairing missing content.
- CSS hides incomplete rows with `visibility: hidden`, preserving layout height and preventing visual jumps while data settles.
- CSS flags depend only on styles already loaded by the page and remove the runtime network/decode failure mode introduced by ranking-specific SVG images.

## Validation

- Added a Playwright regression that injects the observed partial `s` state without a flag, verifies the row is hidden and busy, then supplies `10.604 s` and verifies the complete row becomes visible with a CSS-rendered Spain flag.
- The same regression removes the completed flag and verifies the observer restores it automatically.
- Updated the main responsive journey to assert `role="img"`, accessible country labels, and non-empty CSS gradients for Spain and Argentina.
- Added source-contract assertions for numeric time validation, all-row gating, subtree and character-data observation, synchronous CSS flags, stale-ready revalidation, busy-state removal, and incomplete-row hiding.
- The first CI attempt exposed `security/detect-unsafe-regex`; the time parser was rewritten without a regular expression and the subsequent ESLint job passed.
- Removing image-backed flags exposed the two SVG files as orphan assets; both obsolete assets and their outdated test contract were removed.
- Pull Request Quality Pipeline run `425` passed, including syntax, ESLint, Vitest, dependency and security policy, Knip, public asset checks, and local Supabase integration.
- Player Pages and Social Cards run `157` passed, including responsive Playwright journeys, the partial-time regression, missing-flag repair, frontend module coverage, and generated previews.
- Public Asset Audit run `98` passed.
- Pull Request Visual Evidence remains blocked because the workflow requires actual Markdown image attachments in the PR body; the available connector cannot upload binary PR attachments and generated screenshots are intentionally not committed to Git.

## Rollback

Revert the home normalizer, final stylesheet, asset removals, tests, and this specification. No persistent data rollback is required.

## Delivery

- Branch: `agent/fix-atomic-ranking-render`
- Base: `main`
- Pull request: `#22`
- Normal pull request; no merge or deployment without explicit authorization.

## Status

Implementation and automated validation complete. Pull request open and blocked only by the required manual visual-evidence attachments.