# Testing and runtime validation policy

## Purpose

Tests must prove changed behavior at the boundary where users and systems observe it. Coverage percentages, snapshots and mocks are supporting evidence; none of them replaces a complete behavioral journey.

Use the smallest deterministic test layer that can prove each rule, then add real integration and browser proof for boundaries that cross the database, Edge Functions, browser runtime or deployment workflow.

## Required test design

Before implementation, derive tests from the task specification and acceptance criteria. For every changed behavior, identify:

- the successful path;
- relevant minimum, maximum and empty boundaries;
- invalid or malformed input;
- unauthorized and forbidden access;
- stale, duplicated, partial or reordered data;
- timeout, expiry, cancellation and retry behavior;
- idempotency and repeated execution;
- concurrency, multi-tab or race behavior when shared state is involved;
- compatibility during rolling frontend/backend deployment when contracts can temporarily differ;
- rollback and forward-migration behavior when persisted data is involved.

Only include cases that are relevant to the change, but record the risk analysis in the task specification. A bug fix starts with a regression that reproduces the reported failure or its verified root cause when practical.

## Coverage contract

- New isolated decision modules, state machines, parsers, validators, security gates and controllers require 100% line, function and branch coverage.
- Critical changed logic should be extracted behind a pure boundary when that improves deterministic testing without creating a speculative abstraction.
- Existing coverage must not decrease. Changed branches and error paths must be exercised even when the surrounding legacy or I/O-heavy module cannot reasonably reach a whole-file 100% gate.
- A 100% repository-wide number is not a substitute for useful assertions and is not required for untouched legacy or generated glue. Do not add low-value tests solely to increase a percentage.
- Any exception for new isolated logic must be documented in the task specification with the exact reason, uncovered branch and alternative runtime evidence. Do not lower an existing threshold.

## Unit and contract tests

Unit tests cover pure decisions, normalization, state transitions, ordering, formatting and security invariants. Contract tests cover public API shapes, headers, permissions, content types, cache policy, workflow commands, script ordering and compatibility boundaries.

Tests must assert outcomes rather than implementation trivia. Avoid duplicating production algorithms inside the test. Control time, randomness and identifiers. Do not use `.skip`, `.only`, retries or snapshot updates to hide a failure.

## Real integration tests

When behavior crosses a backend boundary, use the real local stack for at least one critical journey:

- apply the actual migrations to an empty database;
- run the real PostgreSQL functions and permission model;
- run the actual Supabase Edge Function entrypoint;
- exercise the public HTTP contract;
- verify persisted rows, counters, isolation and idempotency through observable contracts;
- cover concurrent execution with real transactions when locking, quotas, reservations or uniqueness are part of the behavior.

Mocks may supplement real integration to force rare failures, partial responses, delays or third-party behavior. They must not be the only proof of a critical repository-owned frontend-to-database flow.

## Playwright acceptance journeys

Playwright tests use the production application code in a real browser. A critical complete journey should prove the sequence from entry to durable result:

1. load the real route and initial state;
2. perform the same user interaction as production;
3. cross the real local API/database boundary when the feature depends on it;
4. assert request count and public payload where relevant;
5. assert the resulting UI and accessibility state;
6. reload or navigate back when persistence or route restoration matters;
7. verify the final state remains correct;
8. assert no unexpected page errors, console errors, failed requests or horizontal overflow.

Run the maintained Desktop Chrome and Mobile/Pixel projects for user-facing behavior. Also cover keyboard and focus behavior, reduced motion, safe-area/responsive states and orientation or viewport boundaries when relevant.

Network interception is allowed to make failure, race, stale-response and rolling-deployment scenarios deterministic, or to replace an external provider. Do not mock the repository code under test or treat an intercepted happy path as the sole end-to-end proof when a real local backend journey is feasible.

Do not add production-only semantic selectors that weaken anti-automation controls. Prefer roles, labels, stable public attributes and observable outcomes. Fixed sleeps are not synchronization; use event, locator, response or state-based waiting. A bounded time advance is acceptable only when elapsed time is itself the behavior under test or when recording evidence, and the reason must be clear in the test.

## Database and migration validation

Database changes require:

- clean setup from an empty database;
- incremental application from the current schema;
- a production-shaped upgrade regression when drift or legacy objects are relevant;
- repeated application or idempotency checks where functions or compatibility migrations are replaceable;
- permission and RLS assertions;
- concurrent or locking tests for shared invariants;
- forward-only rollback guidance without rewriting applied migrations.

Deployment planners and destructive-operation guards fail closed on unknown or divergent state. Dry-run and apply must use the same computed plan.

## Visual evidence

Visual evidence follows `.agents/visual-evidence.md`. PNG, WebM and GIF artifacts complement assertions; they do not replace functional, accessibility, integration or persistence checks.

## Completion gate

A task is complete only when the final pull-request head has:

- the specification acceptance criteria traced to tests or explicit runtime evidence;
- relevant unit, contract, security, integration, coverage and Playwright checks passing;
- no unexplained skips, retries, warnings, console errors, network errors or flaky reruns;
- the complete frontend evidence artifact when visual behavior changed;
- exact commands, workflow runs and blockers reported truthfully.
