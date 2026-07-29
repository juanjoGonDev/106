# Auth entitlement migration guard

## Request

Investigate and fix production Supabase deployment run `30452463947`, job `90577609724`, which failed immediately after merging PR #39.

## Evidence

- The production workflow stopped before linked dry-run, migration application or Edge Function deployment.
- `scripts/check-production-migrations.mjs` scanned migrations added between push base `252b830c97056a448aac8bb7b34efda24d1f5dc7` and merge commit `b338dafb7e9471bfcb2afffdb7e18aa385c69eb0`.
- `supabase/migrations/20260727120400_auth_provider_rewards.sql` contained a top-level `DELETE FROM` without the required `production-data-loss-approved` annotation.
- The statement deletes only a legacy `verified_email_daily_attempt` row when the same account already has the canonical `auth_identity_daily_attempt` row. The preceding update migrates legacy rows when no canonical row exists, so the entitlement remains represented.
- The failed deployment did not apply this migration to production.

## Decision

- Keep the production guard fail-closed.
- Add an explicit reviewed approval immediately above the one intentional consolidation statement, including the preservation invariant.
- Add a regression test against the real migration file so removal of the approval or an additional top-level destructive operation fails CI.
- Do not alter an applied migration; this migration is still unapplied because the deployment stopped at the guard.

## Acceptance criteria

- [x] The real auth provider rewards migration passes `migrationViolations`.
- [x] The migration documents that only duplicate legacy entitlement rows are removed after a canonical equivalent exists.
- [x] Generic unapproved top-level deletes remain rejected.
- [x] No production deployment, remote migration or secret change is performed.
- [x] Pull-request CI is green on the functional head.
- [ ] Pull-request CI is green on the final documentation head.

## Risks

- A broad file-level approval could conceal later destructive edits. The annotation is placed directly above the reviewed statement, and the regression verifies one top-level delete plus exactly one violation when the approval is removed.
- Editing a migration after application would violate forward-only migration policy. The workflow evidence confirms this migration was blocked before application.

## Validation

Functional head `4d99d4116762e0f7e8a5132b25e48708f11bebd2`:

- Pull Request Quality Pipeline `30454004314`: success.
- Player Pages and Social Cards `30454004315`: success.
- Authentication Quality `30454004189`: success.
- Public Asset Audit `30454004182`: success.
- Pull Request Visual Evidence `30454004177`: success.
- Unit/security tests, ESLint, Knip, build and security checks passed.
- Supabase `security`, `ready-flow`, `gameplay-core`, `gameplay-sharing`, `auth-api`, `auth-browser` and `migrations` jobs passed.
- No deployment workflow ran from the task branch.

## Rollback

Revert the annotation and regression test before the migration is applied. After production application, do not rewrite the migration; use a new forward migration for any correction.

## Delivery

- Branch: `agent/fix-auth-entitlement-migration-guard`
- Pull request: `#49`
- Base: `main`
- Merge/deploy/remote migration: not authorized

## Status

Implemented and functionally validated. Awaiting final-head CI after this documentation update.
