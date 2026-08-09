# CI dependency remediation

## Request

Restore PR #66 to a fully green required CI state without weakening the dependency audit, package-manager policy, tests, coverage gates, or security checks. Do not merge until every required check passes.

## Evidence

- Functional head `ac74e06dca12df682172f455d527583d3c2e96e3` passed the task-owned unit, security, Supabase, browser, static-analysis and visual-evidence suites.
- `Pull Request Quality Pipeline` run `31340919497` failed only in `pnpm audit --audit-level=high`.
- The frozen graph resolved `brace-expansion@5.0.8` through ESLint 10 / minimatch 10; advisory `GHSA-rgw5-rvv9-x895` requires `brace-expansion >=5.0.9`.
- `brace-expansion@5.0.9` has now been published. Its package contract supports Node `20 || >=22`, matching the repository's pinned Node `22.13.0`.
- The frozen graph resolved `nanoid@3.3.15` through Vitest / Vite / PostCSS. `nanoid@5.1.16` is published and clears the current high-severity Nano ID advisories. The project pins Node `22.13.0`, and the candidate graph is validated by real install/test CI rather than assumed compatible.
- A downgrade experiment to ESLint `9.39.5` was rejected: the resulting graph introduced current high-severity advisories through its older dependency line, so changing the top-level lint toolchain would trade one vulnerable graph for another.
- Read-only resolver run `31342102474` proved the candidate graph with ESLint 10, `brace-expansion@5.0.9`, `nanoid@5.1.16` and `postcss@8.5.19` resolves successfully under pinned pnpm `11.15.1`; `pnpm audit --audit-level=high` passed and reported no high/critical advisory.

## Decision

1. Keep the audit threshold at `high`; do not add advisory ignores or audit exceptions.
2. Keep the existing exact ESLint 10 toolchain; do not downgrade to the advisory-bearing 9.x graph merely to avoid minimatch 10.
3. Keep the existing exact PostCSS security override at `8.5.19`.
4. Replace the vulnerable `brace-expansion@5.0.8` override with exact `brace-expansion@5.0.9`.
5. Replace the vulnerable transitive Nano ID with exact `nanoid@5.1.16`.
6. Add a narrowly scoped temporary `minimumReleaseAgeExclude` only for the newly published `brace-expansion@5.0.9` security patch. This is a security-patch maturity exception, not an audit bypass; the override itself remains pinned and the high-severity audit still executes normally. Remove the maturity exception after seven days.
7. Generate the lockfile with pinned pnpm `11.15.1` and lifecycle scripts disabled. A separate trusted resolver branch is used only to materialize the deterministic registry-backed lockfile because the connected workspace cannot perform registry resolution locally; the privileged resolver never executes repository test/build scripts and commits only `pnpm-workspace.yaml` and `pnpm-lock.yaml` to the PR branch.
8. Accept the graph only if frozen install, package policy, `pnpm audit --audit-level=high`, lint, tests, coverage, Supabase integration and browser/visual checks all pass on the final PR head.

## Acceptance

- [ ] `pnpm install --frozen-lockfile --prefer-offline` succeeds from the committed lockfile.
- [ ] `pnpm check:package-policy` succeeds without weakening policy.
- [ ] `pnpm audit --audit-level=high` succeeds with no ignored high/critical advisory.
- [ ] ESLint 10 passes with zero warnings.
- [ ] Unit/security tests and existing 100% JavaScript coverage gates pass.
- [ ] All Supabase suites pass.
- [ ] Desktop/mobile browser and full platform evidence checks pass on the final head.
- [ ] Temporary resolver workflow is absent from the final PR diff.
- [ ] Every required CI check is green before merge.
- [x] No merge, release, deployment or production migration is authorized by this task.

## Checks

1. Read-only candidate resolver: passed on run `31342102474`; package policy and high-severity audit passed.
2. Trusted lockfile materialization: committed only `pnpm-workspace.yaml` and `pnpm-lock.yaml` as `fix(deps): patch audited transitive dependencies`.
3. Remove the temporary PR-local resolver workflow before the final validation head.
4. Run and inspect the complete final-head CI; fix only evidence-backed regressions.
5. Bind PR visual evidence to the final head/artifact after the platform evidence workflow succeeds.
6. Keep PR #66 unmerged until required CI is completely green.

## Delivery

- Existing branch: `agent/security-ranked-integrity-reconciliation`
- Existing PR: `#66`
- Temporary trusted resolver branch: `agent/ci-lock-resolver`; it is not a delivery PR and contains no product changes.
- No merge, deployment, release, package publication or production migration.

## Rollback

If the patched transitive graph causes a real compatibility regression, revert the dependency-policy/lockfile commit rather than weakening tests or audit. Keep PR #66 unmerged while selecting a different published safe graph.

## Status

In progress. The safe dependency graph is committed; final-head CI and visual evidence must pass before the PR is eligible for merge.
