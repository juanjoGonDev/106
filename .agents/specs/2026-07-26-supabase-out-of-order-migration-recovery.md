# Supabase out-of-order migration recovery

## Request

- Investigate failed production Supabase deployments `30142222201` and `30200176388`.
- Correct the deployment path in a new pull request because PR #35 is already merged.
- Preserve production data and avoid manual or destructive migration history edits.

## Evidence

- Both production runs completed configuration, CORS repair, CLI installation and project linking successfully.
- Both runs failed at `Preview pending migrations`, before snapshots, SQL application, Edge Function secrets or Edge Function deployment.
- PR #31 added compatibility migration `20260724213350_adopt_legacy_player_achievement_highlights.sql` after production had already encountered the surrounding `20260724213400` and `20260724213500` rollout.
- The current workflow invokes `supabase db push --linked --dry-run` and `supabase db push --linked --yes` without planning for a local migration absent from remote history but older than the remote migration tip.
- Supabase CLI supports `--include-all` specifically to include migrations not found in remote history, including an out-of-order compatibility migration.

## Decision

1. Read `supabase migration list --linked` before the dry-run and derive a deterministic migration plan.
2. Fail closed when remote history contains any version that is absent from the repository.
3. Enable `--include-all` only when a pending local migration predates the newest remote migration; keep the normal incremental mode otherwise.
4. Use the same planned mode for dry-run and real application so preview and deployment cannot diverge.
5. Re-run the production migration safety guard across the complete local migration chain before any include-all push.
6. Publish the remote tip, pending versions and out-of-order recovery mode in the GitHub Actions summary.

## Scope

- GitHub Actions production Supabase workflow.
- Pure Node.js migration-list parser and planner.
- Vitest coverage for aligned, out-of-order, ANSI/ASCII and remote-only histories.
- No migration SQL, database object, Edge Function or frontend change.

## Risks

- `--include-all` can apply any local migration missing from remote history. The workflow therefore enables it only after explicit history classification and a full-chain destructive-migration scan.
- A remote-only version indicates repository/history divergence that cannot be safely inferred. The planner blocks instead of using `migration repair` automatically.
- The production run after merge remains the authoritative validation of the remote migration history and compatibility migration.

## Acceptance

- [x] Both provided failing runs are traced to the migration preview boundary.
- [x] A pending migration newer than the remote tip uses standard `db push`.
- [x] Pending `20260724213350` behind remote `20260724213500` selects `--include-all`.
- [x] Dry-run and apply receive the same mode.
- [x] Remote-only migration versions fail closed.
- [x] The complete local migration chain is safety-scanned before recovery.
- [x] Workflow summary exposes the migration plan without credentials.
- [ ] Pull-request CI is green on the final head.
- [ ] Production deployment succeeds after an authorized merge.

## Validation

- Static syntax registration added for the migration planner.
- Unit and workflow-contract tests added in `tests/production-migration-planner.test.js`.
- Pull-request workflow results will be recorded after the branch is published.

## Rollback

Revert the workflow, planner, tests and specification. No production data or migration history is mutated by this pull request itself. Do not rewrite, delete or mark migrations manually; any later schema correction must remain forward-only.

## Delivery

- Branch: `agent/fix-supabase-out-of-order-migrations`
- Pull request: pending
- Merge: not authorized
- Production deployment: not authorized

## Status

Implementation prepared; awaiting pull-request validation.
