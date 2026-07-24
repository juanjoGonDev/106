# Home statistics synchronization

## Request

Investigate why the main page performs multiple Supabase statistics requests and why network delay can randomly leave the ranking visually empty or show the full score `1404` instead of the compact `1.4K` representation. Make the home deterministic, efficient and covered by sequential delayed browser tests. The final architecture must not retain backward-compatibility adapters for the duplicated statistics consumers.

## Evidence

- `app.js` requested `stats` during initialisation and rendered the score and ranking.
- `v3.js` independently requested `stats` for daily awards.
- `v4.js` independently requested `stats` for a fallback ranking renderer.
- `ranking-enhancements.js` independently requested `stats` for enriched awards and could perform extra public-profile lookups.
- `competition.js` independently requested `stats` for compact score formatting and intercepted `fetch` to modify game requests and results.
- These calls could resolve in any order and used incompatible DOM structures.
- `home-ranking-density.js` hid incomplete non-empty rows while waiting for legacy fields. A final partial renderer could therefore leave an apparently tall but blank ranking.
- `app.js` wrote locale-formatted full scores after `competition.js` compacted them, so the last response determined whether the user saw `1.4K` or `1404`/`1.404`.

## Decision

1. Make `home-stats.js` the only owner of the initial `stats` request, the snapshot and the home statistics render.
2. Remove the `window.fetch` interception, response cloning, temporary response cache and delayed compatibility commit.
3. Remove every other initial `stats` request and all fallback or legacy ranking renderers.
4. Render complete ranking rows directly from the validated snapshot with accessible flags, explicit nick and time nodes, and a terminal `ready`, `empty` or `error` state.
5. Render daily awards by subscribing to the shared snapshot; never resolve missing award teams through extra profile requests.
6. Pass miniliga context explicitly when starting a game and pass completed results explicitly back to the competition module.
7. Commit statistics returned by a completed attempt directly to the store without another Supabase read.
8. Keep `home-ranking-density.js` limited to responsive placement; remove MutationObserver-based legacy row repair.
9. Compact scores in the authoritative renderer while preserving the deterministic full value in `title` and use uppercase `K` consistently.

## Scope

- `public/home-stats.js`
- `public/app.js`
- `public/v3.js`
- `public/v4.js`
- `public/competition.js`
- `public/ranking-enhancements.js`
- `public/home-ranking-density.js`
- `public/index.html`
- `public/format.js`
- package and Knip entrypoint checks
- unit contract tests
- sequential desktop and mobile Playwright coverage

## Acceptance

- Exactly one source file contains the home `stats` request.
- One actual Supabase `stats` request occurs per initial page load.
- No home module intercepts `window.fetch` for statistics or competition integration.
- No fallback ranking renderer, legacy row normalizer or auxiliary award profile lookup remains.
- Delays of 0 ms, 35 ms, 140 ms and 420 ms produce the same complete ranking.
- The ranking has no lingering `aria-busy` state and contains all expected names, times and accessible flags.
- Waiting after the delayed response cannot replace the committed ranking with stale or partial content.
- A Spain score of 1404 always renders as `1.4K` and exposes `1.404` as the full value.
- Attempt completion commits returned statistics and competition results explicitly without another Supabase read.
- Syntax, lint, dead-code, unit, security, browser, Supabase and repository checks pass.

## Risks

- Removing the compatibility paths exposes any undocumented consumer that still depended on legacy DOM shapes; contract tests reject such consumers rather than preserving them.
- Award entries without a valid `team` now surface as unavailable instead of causing hidden profile requests.
- The explicit miniliga boundary requires `Minuto106Competition` to be loaded before the user can start an attempt; scripts are loaded before interaction is possible.

## Tests

- Vitest verifies single ownership, absence of fetch interception, absence of duplicated statistics actions, direct snapshot rendering, explicit attempt/competition integration and compact/full score semantics.
- Playwright reloads the same page sequentially with artificial delays of 0 ms, 35 ms, 140 ms and 420 ms on desktop and mobile, counts network calls and validates the stable final DOM after an additional wait.
- Browser coverage verifies snapshot publication, completed-attempt updates and authoritative DOM reconstruction without fallback ranking repair or auxiliary award requests.
- Existing gameplay, account, security and Supabase integration tests remain applicable.

## Rollback

Revert the branch commits. No database, migration, API contract or production data change is involved.

## Validation

- Pull Request Quality Pipeline #506: passed, including syntax, ESLint, Knip, Vitest, security policy and local Supabase integration.
- Player Pages and Social Cards #238: passed on desktop and mobile, including the sequential delayed statistics journeys.
- Pull Request Visual Evidence #208: passed.
- Public Asset Audit #179: passed.
- Validated head before this documentation-only closure: `0e0e7698e464c7b544c16cfd3b4f304032c3e55e`.

## Delivery

- Branch: `agent/fix-home-stats-synchronization`
- Base: `main`
- Pull request: #28, normal and ready for review.
- No merge or deployment without explicit authorization.

## Status

Implemented and validated without backward-compatibility adapters.