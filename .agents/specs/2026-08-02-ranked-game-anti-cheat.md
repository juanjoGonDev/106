# Ranked game anti-cheat hardening

## Request

Harden ranked attempts against trivial HTTP automation without penalizing users for network latency. Preserve the browser monotonic elapsed time as the displayed and scored duration, hide the numbered-ball solution from normal clients, remove next-ball hints, make attempt transitions replay-safe, and validate the complete browser-to-Edge-Function-to-PostgreSQL flow with real local Supabase and Desktop/Mobile Playwright coverage.

## Evidence

- `game-ready-api` returns ordered ball coordinates, radius and order as JSON. A script can read that response and submit the exact centres without interpreting the canvas.
- The browser highlights the expected ball and announces the next required number.
- `complete_game_human_check` accepts client-authored `trusted: true` metadata; this is not proof of a trusted browser event.
- `finish_game_attempt` currently uses client-authored trust, focus and automation fields when deciding whether a result is verified.
- The database already persists prepared/activated challenge state, locks attempts, consumes challenges once, and reserves concurrent quota. These invariants should be extended rather than replaced.
- The official result already uses `performance.now()`, while PostgreSQL records `server_elapsed_ms` and currently permits a five-second mismatch.
- Turnstile currently succeeds when its secret is absent, including environments that may be production-shaped.

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

## Risks

- Raster challenges remain susceptible to advanced computer vision; the change removes the trivial structured-data bypass but is not claimed to make browser automation impossible.
- Strict timing bounds can reject extremely unstable connections. The selected window is bounded but intentionally wider than ordinary RTT; telemetry will expose rejected deltas for future tuning.
- Data URLs increase response size. The raster is fixed-size, compressed and non-cacheable.
- A local test-solution mechanism would be dangerous if enabled remotely; three independent gates and negative production tests are mandatory.

## Acceptance

- [ ] Normal human-check responses expose no ordered coordinates, radius, order or drawing commands.
- [ ] The challenge is a PNG raster and the browser never reconstructs its solution.
- [ ] No visible, hidden, ARIA, DOM, global, log or network state identifies the next required ball.
- [ ] Incorrect, expired, reused and concurrently completed checks fail safely and refresh.
- [ ] Browser elapsed time remains official and bounded network latency does not inflate the score.
- [ ] Manipulated timing outside the server window is rejected deterministically.
- [ ] Client-authored trust and automation flags cannot authorize a ranked result.
- [ ] Activation, finish, human proof and Turnstile proof are single-use and race-safe.
- [ ] Turnstile fails closed in production-required mode and validates action, hostname, freshness and replay.
- [ ] Real local Supabase tests verify migrations, permissions, state, atomicity and concurrency.
- [ ] Playwright verifies the complete real flow in Desktop and Mobile, persistence after reload, latency behaviour, refresh, cancellation, accessibility and overflow.
- [ ] New isolated logic reaches 100% line, function and branch coverage.
- [ ] Existing quality, security, migration, gameplay and browser checks remain green.

## Checks

- Focused Node coverage for raster and Turnstile policy modules.
- Vitest contract/security tests.
- Clean local Supabase migration and readiness/security suites.
- Real concurrent HTTP requests for replay and finish races.
- Playwright `desktop-chrome` and `mobile-chrome` against local Supabase.
- Syntax, ESLint, Knip, package policy, public assets, full unit suite and CI quality gate.

## Rollback

Revert browser, Edge Function, tests and CI wiring. Do not delete or rewrite the applied migration; add a forward corrective migration restoring prior function behaviour if rollback is required after deployment.

## Delivery

- Branch: `agent/security-ranked-game-anti-cheat`
- Base: `main`
- Normal non-draft pull request.
- No merge, deployment, publication, production migration or secret modification without explicit authorization.

## Status

Implementation in progress.
