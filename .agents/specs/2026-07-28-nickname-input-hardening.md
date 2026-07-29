# Nickname and input hardening

## Status

In progress.

## Request

Prevent malformed nicknames such as `..` and `../..` from being registered or escaping the application route. Require a minimum nickname length of three characters. Run every nickname eligibility check during the debounced pre-game lookup, before CAPTCHA or the one-time visual challenge. Preserve the existing multilingual offensive/reserved-name moderation. Audit every public search/input boundary for SQL-injection resistance and add deterministic unit, integration and Playwright coverage.

## Evidence

- The home form enables progression from a two-character trimmed nickname.
- `playerUrl()` builds a clean path from the nickname. URL dot-segment normalization can turn a nickname such as `..` into a parent route.
- `player-context` previously accepted any normalized nickname of at least two characters and did not run the existing profanity/reserved-name moderation.
- Write actions in `game-api` and `league-api` use named Supabase RPC calls with parameter objects, but the security contract currently audits primarily `game-api` and does not exercise every public search boundary.
- Existing production data may contain malformed legacy nicknames. Renaming or deleting those rows is destructive and is outside this change; new writes must be blocked and legacy links must fail safely inside the application.

## Decisions

1. A valid nickname has 3–24 Unicode code points after NFKC normalization and whitespace collapse.
2. Allowed characters are Unicode letters and numbers plus single internal spaces, `_`, `-`, `.`, straight apostrophe and typographic apostrophe.
3. The first and last character must be a letter or number. Repeated separators, controls, bidi/zero-width characters, slash and backslash are invalid.
4. Structural validation runs synchronously while typing. Reserved/offensive validation runs through the existing debounced `player-context` request.
5. CAPTCHA and the one-time visual challenge remain unavailable until the debounced nickname result is valid and unoccupied.
6. Every Edge Function that creates, links or resolves a nickname applies the same server policy. PostgreSQL receives a forward-only `NOT VALID` constraint so new/updated rows are protected without destructively rewriting legacy rows.
7. Public profile URL builders never place an invalid nickname into a clean path. Invalid legacy values fall back to the query-based profile shell and render an in-app validation error.
8. SQL resistance is provided by strict input bounds plus literal named RPC calls with parameter objects. No request value may choose an RPC/function name or construct SQL.
9. Search payloads remain data. SQL-like strings must not cause 5xx responses, mutate schema/data unexpectedly or bypass authorization.

## Acceptance criteria

1. `..`, `../..`, slash/backslash, control/bidi/zero-width characters, punctuation-only values and names shorter than three characters are rejected.
2. Valid international names such as `Álvaro`, `李雷`, `O'Neil` and `Jean-Luc` remain valid.
3. Reserved and offensive names are rejected by the debounced lookup before CAPTCHA becomes usable.
4. The start action cannot be reached with a locally invalid, remotely invalid, pending or occupied nickname.
5. Ranking/profile/account links generated from malformed legacy data remain under the Minuto 106 application origin/path and show an in-app invalid-route state.
6. New malformed nicknames cannot be inserted or updated through repository-owned Edge Functions or the database constraint.
7. `game-api`, `player-context`, `league-api`, profile/share routes and search endpoints use bounded inputs and parameterized named RPC calls.
8. SQL-like payloads against nickname and league-search inputs return controlled responses and leave subsequent health/stat queries functional.
9. The shared browser/server policy corpus has 100% line, function and branch coverage.
10. Desktop and Mobile Playwright cover progressive validation, debounce moderation, CAPTCHA gating, safe route generation and search rejection without page/console/request errors or overflow.
11. The final PR head has all CI checks and refreshed visual evidence green.

## Validation plan

- Node coverage for browser and server nickname policy implementations with a shared attack/compatibility corpus.
- Vitest static security audit for all public Edge Function sources and migration SQL.
- Real local Supabase probes for malformed nicknames and SQL-like search payloads.
- Playwright Desktop/Mobile journeys for structural errors, reserved/offensive debounce responses, valid recovery, CAPTCHA gating and route containment.
- Clean database rebuild, migration lint, permission/RLS checks and full existing quality suite.

## Rollback

Revert the frontend, Edge Function and additive migration commits. The database constraint is additive and `NOT VALID`; a corrective forward migration may drop or replace it. Do not rewrite an applied migration or mutate legacy nickname rows during rollback.

## Delivery

Reuse `agent/feat-supabase-auth-account-linking` and PR #39 because the reported bug was found while validating that branch. No merge, deployment, remote migration or destructive cleanup is authorized.