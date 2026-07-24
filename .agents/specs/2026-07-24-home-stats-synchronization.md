# Home statistics synchronization

## Request

Investigate why the main page performs multiple Supabase statistics requests and why network delay can randomly leave the ranking visually empty or show the full score `1404` instead of the compact `1.4K` representation. Make the home deterministic, efficient and covered by sequential delayed browser tests.

## Evidence

- `app.js` requests `stats` during initialisation and renders the score and ranking.
- `v3.js` independently requests `stats` for daily awards.
- `v4.js` independently requests `stats` for a fallback ranking renderer.
- `ranking-enhancements.js` independently requests `stats` for enriched awards.
- `competition.js` independently requests `stats` for compact score formatting.
- These calls can resolve in any order and use incompatible DOM structures.
- `home-ranking-density.js` hides incomplete non-empty rows while it waits for every field. A final partial renderer can therefore leave an apparently tall but blank ranking.
- `app.js` writes locale-formatted full scores after `competition.js` has compacted them, so the last response determines whether the user sees `1.4K` or `1404`/`1.404`.

## Decision

1. Add a home statistics coordinator before every module that consumes `stats`.
2. Deduplicate concurrent startup `stats` calls at the fetch boundary and return independent response clones to legacy consumers.
3. Keep the shared response briefly so module and `DOMContentLoaded` consumers reuse the same network result; expire it to allow later genuine refreshes.
4. Store the latest valid snapshot and perform one authoritative atomic presentation after legacy renderers and mutation observers have settled.
5. Rebuild every ranking row from validated data with accessible flags, explicit nick and time nodes, and a final `ready` render state.
6. Compact scores in the authoritative renderer while preserving the deterministic full value in `title`.
7. Use uppercase `K` consistently for thousands.
8. Recommit statistics delivered by a completed attempt without a new network request.

## Scope

- `public/home-stats.js`
- `public/index.html`
- `public/format.js`
- package and Knip entrypoint checks
- unit contract tests
- sequential desktop and mobile Playwright coverage

## Acceptance

- One actual Supabase `stats` request occurs per initial page load despite all current consumers.
- Delays of 0 ms, 35 ms, 140 ms and 420 ms produce the same complete ranking.
- The ranking has no lingering `aria-busy` state and contains all expected names, times and accessible flags.
- Waiting after the delayed response cannot replace the committed ranking with stale or partial content.
- A Spain score of 1404 always renders as `1.4K` and exposes `1.404` as the full value.
- Attempt completion can commit returned statistics without another Supabase read.
- Syntax, lint, dead-code, unit, security, browser, Supabase and repository checks pass.

## Risks

- The coordinator currently protects legacy consumers at the fetch boundary rather than deleting all historical renderers in one breaking refactor.
- Response caching must be short-lived so later explicit refreshes can reach Supabase.
- The authoritative render must execute after legacy microtasks and zero-delay timers without adding visible latency.

## Tests

- Vitest verifies script ordering, request deduplication, cache expiry, atomic row construction and compact/full score semantics.
- Playwright reloads the same page sequentially with artificial delays of 0 ms, 35 ms, 140 ms and 420 ms on desktop and mobile, counts network calls and validates the stable final DOM after an additional wait.
- Existing ranking race, daily award, gameplay, account, security and Supabase integration tests remain applicable.

## Rollback

Revert the branch commits. No database, migration, API contract or production data change is involved.

## Validation

Implementation head `4b570cb949e26812310ce320b336be4ddb1b30f6` passed:

- Pull Request Quality Pipeline #490, including syntax, ESLint, Knip, Vitest, security policy, dependency audit, local Supabase API integration and the final quality gate.
- Player Pages and Social Cards #222, including module coverage and the complete desktop/mobile Playwright matrix.
- Pull Request Visual Evidence #190.
- Public Asset Audit #163.
- Generated desktop and mobile evidence confirms a complete three-row ranking, deterministic `1.4K` score and responsive layout.

The final branch head only removes temporary evidence files after their commit-pinned URLs are recorded; the same CI suite is required on that final head.

## Delivery

- Branch: `agent/fix-home-stats-synchronization`
- Base: `main`
- Pull request: #28, normal and ready for review.
- No merge or deployment without explicit authorization.

## Status

Implemented, validated and delivered in PR #28.
