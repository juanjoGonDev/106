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
5. Pass the exact pending-version set into the production migration safety guard before any dry-run or push.
6. Publish the remote tip, pending versions and out-of-order recovery mode in the GitHub Actions summary.

## Scope

- GitHub Actions production Supabase workflow.
- Pure Node.js migration-list parser and planner.
- Exact-version support in the existing production migration safety guard.
- Vitest coverage for aligned, out-of-order, ANSI/ASCII, remote-only and invalid selection histories.
- No migration SQL, database object, Edge Function or frontend change.

## Risks

- `--include-all` can apply any local migration missing from remote history. The workflow therefore enables it only after explicit history classification and safety-checks every exact pending migration.
- A remote-only version indicates repository/history divergence that cannot be safely inferred. The planner blocks instead of using `migration repair` automatically.
- The production run after merge remains the authoritative validation of the remote migration history and compatibility migration.

## Acceptance

- [x] Both provided failing runs are traced to the migration preview boundary.
- [x] A pending migration newer than the remote tip uses standard `db push`.
- [x] Pending `20260724213350` behind remote `20260724213500` selects `--include-all`.
- [x] Dry-run and apply receive the same mode.
- [x] Remote-only migration versions fail closed.
- [x] Every exact pending migration is safety-scanned before preview and application.
- [x] Invalid, missing or duplicate local migration selections fail closed.
- [x] Workflow summary exposes the migration plan without credentials.
- [x] Pull-request CI is green on the implementation head.
- [ ] Production deployment succeeds after an authorized merge.

## Validation

Validated on implementation head `e819faedeeb47920315e0843e1d96e6da70fa9c4`:

- Pull Request Quality Pipeline `30206801630`: passed build, syntax, Vitest, ESLint, Knip, dependency and security policy, local Supabase integration and Quality Gate.
- Player Pages and Social Cards `30206801624`: passed strict frontend coverage and responsive browser journeys.
- Public Asset Audit `30206801628`: passed.
- Pull Request Visual Evidence `30206801635`: passed.
- Direct deterministic assertions selected `--include-all` for pending `20260724213350` behind remote tip `20260724213500`, while retaining pending `20260726120000`.
- The initial lint failure identified a control-character regular expression; ANSI stripping was rewritten without suppressing or weakening ESLint, and the final ESLint job passed.

## Rollback

Revert the workflow, planner, tests and specification. No production data or migration history is mutated by this pull request itself. Do not rewrite, delete or mark migrations manually; any later schema correction must remain forward-only.

## Delivery

- Branch: `agent/fix-supabase-out-of-order-migrations`
- Pull request: `#36`
- Merge: not authorized
- Production deployment: not authorized

## Status

Complete and ready for review. PR #36 remains open, unmerged and undeployed; production validation requires an authorized merge.
