# Zadmin production migration guard correction

## Request

Investigate and correct failed production Supabase deployment run `31419312524` after merge of PR #71. Deliver the correction on a new task branch and a new normal pull request. Do not merge or deploy from the task branch.

## Evidence

- Production run `31419312524`, job `93555950713`, stopped at `Guard against destructive migrations` before Supabase CLI installation, project linking, migration planning, migration application or Edge Function deployment.
- The guard reported `supabase/migrations/20260810183000_zadmin_attempt_review_risk_scoring.sql: ALTER TABLE ... DROP`.
- The reported migration does not drop a column or persisted row at that location. It drops two existing `CHECK` constraints on `public.game_admin_audit_events` and immediately recreates each constraint with the same name on the same table so the permitted enum-like values can be expanded for attempt review actions.
- `scripts/check-production-migrations.mjs` intentionally treats all `ALTER TABLE ... DROP CONSTRAINT` operations as potentially destructive. It currently contains one hard-coded exception for the same safe drop-and-recreate-`CHECK` pattern on `game_player_achievements`.
- PR #71's migration is already part of `main` and repository policy says merged/applied migration history must not be rewritten. The deployment was blocked before remote migration application.

## Decision

Keep the production migration guard fail-closed and do not annotate this migration with a generic data-loss approval because no data-loss operation is intended.

Generalize the existing hard-coded `CHECK`-constraint expansion exception so the guard permits only a narrowly verified pattern:

1. a top-level `ALTER TABLE <table> DROP CONSTRAINT [IF EXISTS] <name>;` statement;
2. followed later in the same migration by `ALTER TABLE <same table> ADD CONSTRAINT <same name> CHECK (...)`;
3. every destructive `ALTER TABLE ... DROP` occurrence in the file must match such a safe replacement;
4. `DROP COLUMN`, an unrecreated constraint, a recreation on another table/name, or recreation as a non-`CHECK` constraint remains a violation;
5. unknown syntax remains blocked rather than guessed safe.

Use the already-filtered migration execution SQL so function bodies do not affect the deployment guard.

## Scope

### In scope

- `scripts/check-production-migrations.mjs` migration safety decision logic;
- deterministic regression tests for the real zadmin migration and negative destructive cases;
- this task specification;
- final PR validation.

### Out of scope

- editing `20260810183000_zadmin_attempt_review_risk_scoring.sql`;
- changing database behavior or zadmin product behavior;
- weakening `DROP TABLE`, `DROP SCHEMA`, `TRUNCATE`, `DELETE FROM`, `DROP FUNCTION` or `DROP TYPE` guards;
- production deployment, migration execution, secret changes or merge.

## Acceptance criteria

- [x] The real `20260810183000_zadmin_attempt_review_risk_scoring.sql` is covered by a regression asserting no migration-safety violation.
- [x] The previously supported `game_player_achievements` check-constraint expansion remains accepted by the generalized rule.
- [x] A dropped constraint without a later same-table/same-name `CHECK` recreation remains rejected.
- [x] A dropped column remains rejected even if the file also contains safe constraint replacements.
- [x] Recreating the same constraint as `UNIQUE` or on another table remains rejected.
- [x] Multiple safe `CHECK` replacements in one migration are accepted only when every destructive `ALTER TABLE ... DROP` is accounted for.
- [x] Generic destructive migration protections and explicit reviewed approval behavior remain unchanged in the test contract.
- [ ] Relevant unit/security, syntax, lint, dead-code and PR CI checks are green on the final head.
- [x] No remote deployment or migration has been executed from the task branch.

## Test design

- Success: real zadmin migration with both audit-log `CHECK` expansions passes `migrationViolations`.
- Compatibility: existing safe achievement-kind `CHECK` expansion continues to pass.
- Failure: one `DROP CONSTRAINT` with no recreation fails.
- Failure: same table/name recreated with a non-`CHECK` constraint fails.
- Failure: same name recreated on another table fails.
- Failure: safe replacement plus `DROP COLUMN` still fails.
- Boundary: multiple safe replacements are accepted together and cannot mask one unsafe drop.
- Preserve existing tests for runtime-function filtering, top-level destructive statements and explicit production-data-loss approvals.

## Implementation

- Replaced the hard-coded `isVerifiedAchievementCheckExpansion` exception with a fail-closed `hasOnlySafeCheckConstraintReplacements` decision.
- The decision recognizes only simple repository-owned table/constraint identifiers, requires a later same-table/same-name `ADD CONSTRAINT ... CHECK`, removes only those verified drop statements from the residual destructive scan, and rejects any remaining `ALTER TABLE ... DROP` operation.
- Added regression coverage in `tests/production-migration-function-bodies.test.js`, including the real zadmin migration.
- The zadmin migration itself was not modified.

## Validation

Local syntax probes were performed on the new guard logic before committing it. Synthetic runtime probes verified:

- a same-table/same-name `CHECK` replacement is accepted;
- an unrecreated drop is rejected;
- recreation as `UNIQUE` is rejected;
- a safe replacement plus `DROP COLUMN` is rejected;
- multiple newline-separated safe replacements are accepted.

Repository CI on the final PR head remains the authority for the real migration and complete project contract.

## Risks

- A too-permissive regex could hide a destructive constraint change. Mitigation: support only the exact simple top-level syntax already used by repository migrations, require same table/name and a later `CHECK` recreation, remove only verified drop statements from guard evaluation, and fail closed for all unmatched syntax.
- Constraints themselves can enforce data invariants. This change permits replacement only with another `CHECK`; it does not claim semantic equivalence of old/new expressions. The deployment guard's purpose is data-loss prevention, while migration/integration tests remain responsible for schema correctness.

## Rollback

Revert the guard and regression-test commits. No database rollback is required because this task does not change or execute a migration.

## Delivery

- Branch: `agent/fix-zadmin-migration-guard`
- Pull request: `#72`
- One normal non-draft PR targeting `main`.
- No merge, production deployment or remote migration without explicit user authorization.

## Status

Implementation and regression coverage are complete. Final completion is pending required CI checks on the final PR head.
