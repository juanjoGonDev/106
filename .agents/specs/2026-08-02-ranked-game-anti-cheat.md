# Ranked game anti-cheat hardening

## Request

Harden ranked attempts against trivial HTTP automation without penalizing users for network latency. Preserve the browser monotonic elapsed time as the displayed and scored duration, hide the numbered-ball solution from normal clients, remove next-ball hints, make attempt transitions replay-safe, and validate the complete browser-to-Edge-Function-to-PostgreSQL flow with real local Supabase and Desktop/Mobile Playwright coverage.

## Evidence

- `game-ready-api` returned ordered ball coordinates, radius and order as JSON. A script could read that response and submit the exact centres without interpreting the canvas.
- The browser highlighted the expected ball and announced the next required number.
- `complete_game_human_check` accepted client-authored `trusted: true` metadata; this is not proof of a trusted browser event.
- `finish_game_attempt` used client-authored trust, focus and automation fields when deciding whether a result was verified.
- The database already persisted prepared/activated challenge state, locked attempts, consumed challenges once, and reserved concurrent quota. These invariants were extended rather than replaced.
- The official result already used `performance.now()`, while PostgreSQL recorded `server_elapsed_ms` and permitted a five-second mismatch.
- Turnstile succeeded when its secret was absent, including production-shaped environments.

## Decisions

1. Keep `clientElapsedMs`, measured from `performance.now()`, as the official displayed and scored duration.
2. Validate manual attempts against a server-controlled transport delta: `serverElapsedMs - clientElapsedMs` must be between -750 ms and +2500 ms. This permits bounded countdown/request asymmetry and realistic finish latency while rejecting materially fabricated durations. Automatic 30-second expiry uses its own bounded contract.
3. Treat browser trust, focus, pointer and automation claims only as bounded telemetry. Construct the authoritative finish contract from persisted challenge state before invoking the canonical attempt writer.
4. Keep the existing PostgreSQL row lock and single-use challenge consumption. Timing rejection consumes the challenge deliberately to prevent retry-based probing, but does not persist an attempt or consume completed-attempt quota.
5. Render the numbered challenge into a raster PNG in the Edge Function. Persist the structured solution only in `game_human_checks`; return only the check ID, PNG data URL, dimensions, digest and expiry.
6. Collect four neutral click coordinates in the browser and validate the full sequence on the server. The frontend never receives the solution and never highlights or announces the next number.
7. Add a local-test-only solution endpoint protected by an explicit environment flag, localhost origin and a separate test token. It is disabled and inaccessible by default and in production.
8. Turnstile fails closed whenever `APP_ENV=production` or `TURNSTILE_REQUIRED=true`. Validate success, expected action, allowed hostname and freshness; consume a hash once in PostgreSQL so replay is rejected independently of provider behaviour. Local CI uses an explicit test provider mode and non-secret test tokens.
9. Use additive, forward-only migrations. Do not rewrite applied migrations.
10. Keep legacy browser fixture compatibility behind three simultaneous test gates: localhost, `navigator.webdriver`, and a Playwright-only local-storage flag. Production and ordinary local browsers continue rejecting responses without the raster contract.
11. Run the real ranked Playwright journey only from its dedicated Supabase suite. Generic visual shards explicitly exclude the live tag so repository-owned integration remains real without duplicating local backend ownership across every shard.
12. When a CI shard has no `pnpm` binary, bootstrap the exact version declared by `packageManager` through `npx --yes`; this avoids the stale Corepack signing-key set bundled with the pinned Node runtime while preserving the repository's exact pnpm version as the single source of truth.
13. After cancellation or an intercepted start failure, restore focus to the `#startButton` that opened the dialog. This follows the accessible dialog-return pattern and avoids reopening the mobile software keyboard by focusing the nickname field.
14. Cancelling the raster dialog aborts its in-flight verification request. Closing presentation state alone is insufficient because the unresolved request would keep the initiating game action disabled.
15. The live anti-cheat journey keeps the game, player-context, public profile and PostgreSQL paths real, but fulfils unrelated `player-share` PNG requests with a deterministic raster. The actual social renderer remains covered by the separate real `gameplay-sharing` Supabase suite, avoiding a duplicate owner and preventing an unrelated local renderer failure from masking anti-cheat regressions.

## Timing thresholds

- Manual client duration: 2,000–30,000 ms.
- Manual transport delta: -750–2,500 ms.
- Automatic timeout client duration: exactly 30,000 ms.
- Automatic server duration: 29,250–33,000 ms.
- Turnstile maximum challenge age: 300 seconds.

The lower manual delta accounts for the client countdown beginning immediately before the activation request reaches the server. The upper delta is intentionally far below the previous five-second acceptance window while remaining tolerant of mobile scheduling and network delivery.

## Scope

- Shared raster generator and Turnstile policy modules.
- `game-ready-api`, browser human-check flow and Turnstile widget action.
- Additive PostgreSQL migration for replay-safe Turnstile consumption and server-controlled finish validation.
- Real local Supabase security/readiness/concurrency tests.
- Desktop and Mobile Playwright journeys against the real local stack.
- CI and coverage wiring required to execute the new tests.
- Local-only compatibility for existing deterministic Playwright fixtures without restoring the production coordinate contract.

## Risks

- Raster challenges remain susceptible to advanced computer vision; the change removes the trivial structured-data bypass but is not claimed to make browser automation impossible.
- Strict timing bounds can reject extremely unstable connections. The selected window is bounded but intentionally wider than ordinary RTT; persisted deltas support future tuning.
- Data URLs increase response size. The raster is fixed-size, compressed and non-cacheable.
- A local test-solution mechanism would be dangerous if enabled remotely; independent environment, origin and token gates plus negative production tests are mandatory.
- The browser fixture fallback must never become a production compatibility path. Its localhost, WebDriver and Playwright-state gates are intentionally conjunctive and covered by production-negative tests.

## Acceptance

- [x] Normal human-check responses expose no ordered coordinates, radius, order or drawing commands.
- [x] The challenge is a PNG raster and the browser never reconstructs its solution.
- [x] No visible, hidden, ARIA, DOM, global, log or normal network state identifies the next required ball.
- [x] Incorrect, expired, reused and concurrently completed checks fail safely and refresh.
- [x] Browser elapsed time remains official and bounded network latency does not inflate the score.
- [x] Manipulated timing outside the server window is rejected deterministically.
- [x] Client-authored trust and automation flags cannot authorize a ranked result.
- [x] Activation, finish, human proof and Turnstile proof are single-use and race-safe.
- [x] Turnstile fails closed in production-required mode and validates action, hostname, freshness and replay.
- [x] Real local Supabase tests verify migrations, permissions, state, atomicity and concurrency.
- [x] Playwright verifies the complete real flow in Desktop and Mobile, persistence after reload, latency behaviour, refresh, cancellation, accessibility and overflow.
- [x] Dialog cancellation aborts in-flight verification work and restores focus to its initiating control on Desktop and Mobile.
- [x] New isolated logic reaches 100% line, function and branch coverage.
- [x] Existing quality, security, migration, gameplay and browser contracts remain covered by their canonical jobs.

## Checks

- Focused Node coverage for raster and Turnstile policy modules: wired into the canonical 100% coverage job.
- Vitest contract/security suite: passing before final-head evidence generation.
- Clean local Supabase migration, permissions, readiness, security, gameplay, auth and sharing suites: canonical matrix coverage.
- Real concurrent HTTP requests for replay, human-proof completion and finish races.
- Dedicated `@live-ranked-anti-cheat` Playwright journey in Desktop and Mobile against local Supabase; only unrelated social-card PNG rendering is fulfilled deterministically.
- Real player-share renderer coverage remains in the canonical `gameplay-sharing` Supabase suite.
- Full Desktop/Mobile visual shard matrix with screenshots, WebM recordings, GIF derivation and platform manifest.
- Syntax, ESLint, Knip, package policy, dependency audit, public assets and CodeQL.
- Temporary agent workflows and generated helper files removed before final validation.

## Rollback

Revert browser, Edge Function, tests and CI wiring. Do not delete or rewrite the applied migration; add a forward corrective migration restoring prior function behaviour if rollback is required after deployment.

## Delivery

- Branch: `agent/security-ranked-game-anti-cheat`
- Base: `main`
- Pull request: `#60`.
- Normal non-draft pull request.
- No merge, deployment, publication, production migration or secret modification without explicit authorization.

## Status

Implemented. Delivery is complete only when the current head's required CI and visual-evidence checks are green; no production action has been performed.
