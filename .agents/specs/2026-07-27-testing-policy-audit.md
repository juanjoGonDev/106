# Repository testing policy audit

## Request

- Audit the existing task specifications and recent project work for recurring engineering preferences that should become stable repository instructions.
- Preserve the existing full-platform visual evidence standard.
- Make expectations explicit for 100% coverage, edge cases, real Playwright tests and complete user flows.

## Evidence

The audit reviewed the repository instructions, pull-request template, package scripts, representative specifications and the complete pull-request history through PR #38.

Recurring patterns were already implemented repeatedly but were not consolidated into one stable testing policy:

- PRs #11, #12, #13, #14, #23, #26, #30, #33, #34 and #37 enforce 100% line, function and branch coverage for isolated controllers, parsers and decision modules.
- PR #28 tests delayed and reordered responses and asserts one authoritative request, no partial render and no late overwrite.
- PR #35 uses a real local Supabase concurrency journey for multi-tab reservations and validates the final authoritative awards snapshot.
- PRs #31 and #36 use production-shaped migration histories, idempotency and fail-closed planning rather than assuming database state.
- User-facing PRs repeatedly require Desktop and Mobile Playwright journeys, accessibility/keyboard behavior, responsive overflow checks and absence of console or network errors.
- Critical backend work repeatedly validates real PostgreSQL permissions, Edge Functions, HTTP contracts, migrations and persisted state through the local Supabase stack.

The current root `AGENTS.md` required deterministic tests and relevant checks, but did not define when 100% coverage applies, what constitutes a real end-to-end journey, when mocks are acceptable, or which edge/race/database cases must be considered.

## Decision

1. Add `.agents/testing.md` as the stable repository testing and runtime validation policy.
2. Keep the root `AGENTS.md` small and route behavior, API, database, CI and browser changes through that policy.
3. Require 100% line/function/branch coverage for new isolated decision logic, state machines, parsers, validators, security gates and controllers.
4. Do not impose a misleading blanket 100% repository-wide gate on untouched legacy or I/O-heavy glue. Coverage must not decrease, changed branches and error paths must be exercised, and any exception for new isolated logic requires an exact documented reason and alternative runtime proof.
5. Define layered proof:
   - deterministic unit and contract tests;
   - real local PostgreSQL, Supabase Edge Function and HTTP integration for critical backend boundaries;
   - complete Playwright journeys through production browser code;
   - controlled mocks only as supplementary proof for faults, races, partial responses or external providers.
6. Define a complete browser journey as entry, production-equivalent user action, real local backend boundary when applicable, resulting UI/accessibility state, persistence or route restoration after reload/navigation, and clean console/network/overflow checks.
7. Require relevant boundary, invalid, authorization, expiry, idempotency, stale/reordered, rolling-deployment, concurrency and multi-tab analysis in each task specification.
8. Forbid `.skip`, `.only`, retries, snapshot replacement, weakened thresholds and fixed sleeps as mechanisms for hiding or synchronizing failures.
9. Expand the pull-request template with the same proof matrix.
10. Add a Vitest contract that prevents the root router, stable policy and PR checklist from silently losing these requirements.

## Scope

- `AGENTS.md` repository router.
- New `.agents/testing.md` stable policy.
- Pull-request validation checklist.
- Structural policy regression test.
- This task specification and PR metadata.
- No production application, database, API or deployment behavior change.

## Acceptance criteria

- [x] Stable repository instructions explicitly cover relevant edge, failure, race, concurrency, expiry, compatibility and authorization cases.
- [x] New isolated decision/security/controller logic requires 100% line, function and branch coverage.
- [x] The policy distinguishes useful changed-code coverage from a low-value blanket repository percentage.
- [x] Critical backend behavior requires real local database/Edge/HTTP integration.
- [x] Critical browser behavior requires complete Desktop and Mobile Playwright journeys.
- [x] Mocks are supplementary for deterministic faults and cannot be the sole proof of a feasible critical repository-owned end-to-end flow.
- [x] Complete journeys include persistence or route restoration when relevant and assert console, page, request and overflow health.
- [x] Database changes require clean setup, incremental/production-shaped upgrade, permissions, idempotency and concurrency validation when relevant.
- [x] The PR template exposes the same validation matrix.
- [x] A test prevents accidental removal of the policy contract.
- [ ] Final-head CI, evidence contract and canonical platform artifact are green and linked from PR #38.

## Validation

Planned final-head validation:

- `pnpm check`
- `pnpm test:e2e`
- `pnpm test:supabase`
- `pnpm preview:platform`
- Pull Request Quality Pipeline
- Player Pages and Social Cards
- Pull Request Visual Evidence
- Public Asset Audit
- Inspection of the final `platform-evidence-<run-id>` artifact and manifest SHA binding.

## Risks

- A literal requirement for 100% coverage across the entire existing repository would reward superficial tests and make unrelated legacy glue part of every task. The policy instead keeps strict 100% gates for new isolated logic while requiring no regression and meaningful changed-branch coverage elsewhere.
- A literal prohibition on all mocks would make failure, delay, stale-response and external-provider cases less deterministic. The policy permits mocks only as supplementary evidence and requires real local integration for critical repository-owned boundaries.
- The expanded checklist is intentionally detailed. Agents should mark non-applicable cases through evidence in the specification rather than executing irrelevant tests mechanically.

## Rollback

Revert the documentation, template and policy-contract test. No application, schema, production data or generated artifact rollback is required.

## Delivery

- Branch: `agent/chore-visual-evidence-standard`
- Pull request: `#38`
- One branch and one pull request remain in use.
- Merge/deployment: not authorized.

## Status

Implementation complete. Final-head CI and the regenerated head-bound platform artifact are pending.
