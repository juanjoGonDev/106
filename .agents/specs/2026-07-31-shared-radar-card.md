# Shared profile radar and card refresh

## Status

Implementation and final-head validation in progress on `agent/fix-shared-radar-card`. No merge, deployment, release or production migration has been performed.

## Request

After PR #58 was merged and deployed, the browser profile renders the corrected pentagon but the generated profile PNG still displays a different, stale radar. Make the web profile and every shared/downloaded card use the same calculation and force renderer changes to produce a new image URL.

Follow-up production evidence showed that the corrected image appeared only after the affected player completed another attempt. A database migration or profile-contract correction must invalidate all player-card renderer URLs globally; it must not depend on every player producing a new `profileRevision`.

## Evidence

- The browser profile loads its data through `player-context`, which calls `get_game_player_profile` and receives `lifetimeAttemptsUsed`.
- The `player-share` Edge Function called the older `get_game_public_profile` RPC, so its card renderer did not necessarily receive the same lifetime/daily profile contract.
- Browser and Edge contained separate implementations of the five radar scores. The previous parity test only searched both source files for similar expressions; it did not execute one shared model or prove equivalent input payloads.
- The visible profile for `Javiererd90` showed `100/77/25/100/0`, while the embedded social PNG showed an older polygon with low Fiabilidad.
- Card URLs only included `profileRevision`. A code-only scoring, renderer or migration-driven profile-contract change did not increment that data revision for every player, leaving existing URLs unchanged.
- Dynamic player card responses are publicly cached, so an unchanged URL can continue serving the prior renderer after deployment.
- Versioning the general runtime `config.js` would broaden cache invalidation into authentication and unrelated application bootstrapping. The radar renderer needs an isolated cache identity instead.

## Decision

1. Define one canonical, pure radar model under `shared/` and generate the browser and Edge runtime adapters from it.
2. Add a deterministic sync/check command; CI must fail if either generated runtime drifts from the canonical source.
3. Make the browser explanation/rendering layer delegate all scoring and lifetime-attempt normalization to the generated browser model.
4. Make `player-share` import the generated Edge model instead of owning another scoring formula.
5. Make `player-share` load `get_game_player_profile`, matching the browser profile contract and the service-role grant added by PR #58.
6. Add an explicit card-renderer revision to every generated player image URL, independent of `profileRevision`.
7. Use the same renderer revision in browser previews/downloads and crawler `og:image`/Twitter image URLs.
8. Keep profile data revisions and renderer revisions separate: data changes invalidate through `profileRevision`; formula/layout/profile-contract changes invalidate through the global renderer revision.
9. Keep the current score policy unchanged. This task synchronizes contract, implementation and cache identity; it does not redesign the five statistics.
10. Treat the newest timestamped Supabase migration as the lower bound for the global card-renderer revision. The synchronization command automatically advances a stale renderer revision to `latest migration + 1` and fails `--check` until generated runtimes and loaders are committed.
11. Load the generated browser model as its own versioned asset immediately before every `player-ui.js` or `player-stats.js` consumer. Do not embed it into or version `config.js`; radar invalidation must remain isolated from authentication and general runtime configuration.

## Acceptance criteria

1. The screenshot fixture (`bestDifferenceMs=3`, `averageDifferenceMs=351`, `verifiedAttempts=5`, `lifetimeAttemptsUsed=5`, no referrals or bonus attempts) calculates exactly `100/77/25/100/0` in the canonical model.
2. Browser and Edge runtime adapters execute the same canonical model and return identical values for perfect, reset, partial-validity, malformed, explicit-zero and capped inputs.
3. `player-share` no longer calls `get_game_public_profile`; it calls `get_game_player_profile`.
4. The local Edge integration proves the profile payload used by the card exposes `lifetimeAttemptsUsed` and generates a valid PNG from that contract.
5. `public/player-stats.js` contains no independent radar score formula or policy constants.
6. `supabase/functions/player-share/index.ts` contains no independent radar score formula or policy constants.
7. A deterministic check rejects edits to either generated runtime adapter that are not reproduced from the canonical source.
8. Browser card URLs include both the normalized profile revision and explicit renderer revision.
9. Player share HTML emits `og:image`, `og:image:secure_url`, `twitter:image` and `twitter:image:src` with the same renderer revision.
10. A renderer-revision increment changes the image URL even when `profileRevision` is unchanged.
11. The player preview, download and attached native-share file all use the revised URL and do not reuse an in-memory file prepared for an older renderer URL.
12. Desktop and Mobile Playwright display the corrected web radar together with the refreshed profile-card preview, verify the versioned URL, accessibility, no horizontal overflow and no browser/network errors.
13. Unit, contract, syntax, lint, dead-code, security, local Supabase, generated-file, browser and full-platform evidence checks pass on the final PR head.
14. `PLAYER_CARD_RENDERER_REVISION` is strictly greater than the newest committed Supabase migration timestamp.
15. Adding a newer migration without synchronizing the radar model makes `check:player-radar-model` fail; synchronization advances the global card identity without requiring any player attempt or profile write.
16. Every maintained HTML document that consumes player radar or player URL generation loads exactly one versioned canonical model before its first consumer, while `config.js` retains its existing independent cache and test contract.

## Scope

- Canonical radar calculation and generated browser/Edge adapters.
- Player profile rendering integration.
- Player-share profile RPC selection and cache identity.
- Migration-aware global renderer invalidation.
- Browser/Edge parity, URL, integration and Playwright regressions.
- Full-platform visual evidence for the corrected profile/card parity state.
- No scoring-policy change, persisted-data rewrite or production migration.

## Risks

- **Generated-source drift:** checked generated files and behavioral parity tests fail closed.
- **Rolling deployment:** the Edge adapter keeps the lifetime-attempt fallback for older database payloads, while the browser and Edge both prefer explicit `lifetimeAttemptsUsed`.
- **Cache compatibility:** existing crawler caches cannot be purged retroactively, but the migration-aware renderer revision produces a different image URL as soon as the updated share document or versioned browser model is fetched.
- **Global invalidation drift:** a new migration cannot silently retain the old card identity because `check:player-radar-model` compares the revision with the newest migration timestamp.
- **Runtime coupling:** the radar model remains a separate versioned asset; general config and Auth initialization are not invalidated or mocked differently.
- **Contract change:** `get_game_player_profile` is service-role-only and already used by `player-context`; `player-share` also runs with the service role.
- **Scope drift:** the visual card layout remains unchanged except for rendering the correct polygon.

## Test plan

- 100% line/function/branch coverage for the canonical pure model.
- Generated-file sync/check coverage and explicit drift failure.
- Migration timestamp lower-bound and automatic revision advancement tests.
- Behavioral browser/Edge parity over representative and malformed profiles.
- Contract tests for the shared model imports, canonical RPC and renderer-version URLs.
- Loader-order tests for every maintained HTML radar consumer.
- Local Supabase/Edge integration asserting lifetime profile data and PNG output.
- Desktop/Mobile Playwright for web radar plus card preview parity and refreshed URL.
- Existing authentication Playwright journeys to prove isolated radar cache invalidation does not alter `config.js` interception or Auth bootstrapping.
- Complete repository quality and platform-evidence workflows.

## Rollback

Revert the frontend, Edge and generated-model commits normally. No schema or persisted-data rollback is required. If a later renderer revision has shipped, a rollback must use another new revision rather than reusing a previously cached image identity.

## Delivery

- Branch: `agent/fix-shared-radar-card`
- Base: `main` at merged PR #58 (`16cec53120884ac12b6eede55fee54bc8776053e`)
- One normal, non-draft pull request
- No merge, deployment, release or remote migration without explicit approval
