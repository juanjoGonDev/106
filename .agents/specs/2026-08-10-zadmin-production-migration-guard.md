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

- [ ] The real `20260810183000_zadmin_attempt_review_risk_scoring.sql` produces no migration-safety violation.
- [ ] The previously supported `game_player_achievements` check-constraint expansion remains accepted by the generalized rule.
- [ ] A dropped constraint without a later same-table/same-name `CHECK` recreation remains rejected.
- [ ] A dropped column remains rejected even if the file also contains safe constraint replacements.
- [ ] Recreating the same constraint as `UNIQUE`, foreign key, or another non-`CHECK` form remains rejected.
- [ ] Multiple safe `CHECK` replacements in one migration are accepted only when every destructive `ALTER TABLE ... DROP` is accounted for.
- [ ] Generic destructive migration protections and explicit reviewed approval behavior remain unchanged.
- [ ] Relevant unit/security, syntax, lint, dead-code and PR CI checks are green on the final head.
- [ ] No remote deployment or migration is executed from the task branch.

## Test design

- Success: real zadmin migration with both audit-log `CHECK` expansions passes `migrationViolations`.
- Compatibility: existing safe achievement-kind `CHECK` expansion continues to pass.
- Failure: one `DROP CONSTRAINT` with no recreation fails.
- Failure: same table/name recreated with a non-`CHECK` constraint fails.
- Failure: safe replacement plus `DROP COLUMN` still fails.
- Boundary: multiple safe replacements are accepted together and cannot mask one unsafe drop.
- Preserve existing tests for runtime-function filtering, top-level destructive statements and explicit production-data-loss approvals.

## Risks

- A too-permissive regex could hide a destructive constraint change. Mitigation: support only the exact simple top-level syntax already used by repository migrations, require same table/name and a later `CHECK` recreation, remove only verified drop statements from guard evaluation, and fail closed for all unmatched syntax.
- Constraints themselves can enforce data invariants. This change permits replacement only with another `CHECK`; it does not claim semantic equivalence of old/new expressions. The deployment guard's purpose is data-loss prevention, while migration/integration tests remain responsible for schema correctness.

## Rollback

Revert the guard and regression-test commit. No database rollback is required because this task does not change or execute a migration.

## Delivery

- Branch: `agent/fix-zadmin-migration-guard`
- One normal non-draft PR targeting `main`.
- No merge, production deployment or remote migration without explicit user authorization.

## Status

Implementation pending. Final completion requires required checks on the final PR head.
