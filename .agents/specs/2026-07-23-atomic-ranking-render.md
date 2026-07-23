# Atomic home ranking render

## Request

Prevent the home ranking from intermittently rendering an isolated `s` instead of the complete elapsed time. The ranking must remain hidden while any required row field is incomplete and become visible only after rank, team, nickname, elapsed time, and difference are all available.

## Evidence

- The home page has multiple asynchronous ranking producers: the main `stats` renderer and the `v4.js` fallback renderer.
- `public/home-ranking-density.js` normalizes the DOM after those producers mutate `#leaderboard`.
- The previous normalizer accepted any non-empty existing `.ranking-time` text without validating that it contained a numeric elapsed value, so an intermediate `s` could be treated as final content.
- The previous `MutationObserver` watched only direct child-list replacements. It did not retry when a partially created row later received its missing text inside the row subtree.
- The supplied screenshots show the same ranking structure sometimes containing complete values such as `10.604s` and sometimes containing only the unit `s`, which is consistent with a partial DOM state winning the render race.

## Decision

- Treat a row as renderable only when all required fields are present: anchor, player container, supported team, nickname, numeric rank, numeric difference, and a numeric elapsed time followed by seconds.
- Parse and normalize elapsed values to exactly three decimals. A standalone `s`, `NaN s`, an em dash, or any other incomplete value is invalid.
- Validate every visible row before modifying any row. This provides an all-or-nothing render gate for the ranking.
- Set `aria-busy="true"` and hide non-empty ranking rows while any row remains incomplete.
- Observe child, subtree, and character-data mutations so the normalizer retries automatically when delayed data arrives.
- Mark completed rows as normalized to avoid rewriting stable content during observer callbacks while still revalidating their fields.

## Acceptance

- A row containing only `s` is never visible.
- The leaderboard remains busy and its non-empty rows remain visually hidden while any required field is incomplete.
- When the missing elapsed value changes to a valid value such as `10.604 s`, the complete row is normalized and shown automatically.
- Valid elapsed values render as `10.604s`, `9.902s`, and equivalent three-decimal values.
- Existing rank, flag, nickname, difference, profile link, keyboard focus, spacing, desktop placement, and mobile awards behavior remain unchanged.
- No API, database, scoring, authentication, or persistence changes are introduced.

## Scope

- `public/home-ranking-density.js`
- `public/v12.css`
- Home ranking unit/source-contract tests
- Home ranking Playwright regression coverage

## Risks

- If the API or another renderer permanently omits a required row field, the ranking remains in its loading state rather than exposing corrupt content. This is intentional and safer than presenting incorrect data.
- The observer now watches the leaderboard subtree. Completed rows are marked and validated to prevent mutation loops and unnecessary rewrites.
- CSS hides incomplete rows with `visibility: hidden`, preserving layout height and preventing visual jumps while data settles.

## Validation

- Added a Playwright regression that injects the observed partial `s` state, verifies the row is hidden and busy, then supplies `10.604 s` and verifies the row becomes visible as `10.604s`.
- Added source-contract assertions for numeric time validation, all-row gating, subtree and character-data observation, busy-state removal, and incomplete-row hiding.
- Full CI, responsive browser journeys, and visual evidence are pending.

## Rollback

Revert the home normalizer, final stylesheet, tests, and this specification. No persistent data rollback is required.

## Delivery

- Branch: `agent/fix-atomic-ranking-render`
- Base: `main`
- Pull request: pending
- Normal pull request; no merge or deployment without explicit authorization.

## Status

Implementation and regression coverage committed; validation pending.