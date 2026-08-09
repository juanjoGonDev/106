# CI dependency remediation

## Request

Restore PR #66 to a fully green required CI state without weakening the dependency audit, package-manager policy, tests, coverage gates, or security checks. Do not merge until every required check passes.

## Evidence

- Final functional head `ac74e06dca12df682172f455d527583d3c2e96e3` passes the task-owned unit, security, Supabase, browser, static-analysis and visual-evidence suites.
- `Pull Request Quality Pipeline` run `31340919497` fails only in `pnpm audit --audit-level=high`.
- The frozen graph resolves `brace-expansion@5.0.8` through ESLint 10 / minimatch 10; advisory `GHSA-rgw5-rvv9-x895` requires `brace-expansion >=5.0.9`, which is not currently published.
- The frozen graph resolves `nanoid@3.3.15` through Vitest / Vite / PostCSS; current high-severity advisories require either the patched 3.x releases or the patched 5.x line. `nanoid@5.1.16` is published and satisfies both current high-severity Nano ID advisories.
- The project pins Node.js `22.13.0`. Nano ID 5 supports synchronous CommonJS loading on Node.js 22.12+, and PostCSS consumes `nanoid/non-secure`, so the patched 5.x transitive override is testable on the pinned runtime.
- ESLint publishes `9.39.5` as the maintained 9.x line. It uses the older minimatch line rather than minimatch 10 / brace-expansion 5 and remains compatible with the repository's flat `eslint.config.js` contract subject to real lint validation.

## Decision

1. Keep the audit threshold at `high`; do not add advisory ignores or audit exceptions.
2. Replace the current ESLint 10 toolchain with exact `eslint@9.39.5` and `@eslint/js@9.39.5` to remove the unresolved brace-expansion 5 dependency rather than forcing an unpublished or API-incompatible brace-expansion build.
3. Keep the existing exact PostCSS security override and replace the vulnerable transitive Nano ID with exact `nanoid@5.1.16`.
4. Remove the stale `brace-expansion@5.0.8` override. Do not alias a different package or force an API-incompatible brace-expansion major.
5. Generate the lockfile with pinned pnpm `11.15.1` under the repository's existing supply-chain policy. Use a temporary read-only GitHub Actions resolver only because the connected workspace cannot safely regenerate registry-backed lock data locally; remove that workflow immediately after harvesting the deterministic candidate files.
6. Accept the graph only if frozen install, package policy, `pnpm audit --audit-level=high`, lint, tests, coverage, Supabase integration and browser/visual checks all pass on the final PR head.

## Acceptance

- [ ] `pnpm install --frozen-lockfile --prefer-offline` succeeds from the committed lockfile.
- [ ] `pnpm check:package-policy` succeeds without weakening policy.
- [ ] `pnpm audit --audit-level=high` succeeds with no ignored high/critical advisory.
- [ ] ESLint passes with zero warnings under the maintained 9.x toolchain.
- [ ] Unit/security tests and existing 100% JavaScript coverage gates pass.
- [ ] All Supabase suites pass.
- [ ] Desktop/mobile browser and full platform evidence checks pass if retriggered by the dependency head.
- [ ] Temporary resolver workflow is absent from the final PR diff.
- [ ] Every required CI check is green before merge.
- [x] No merge, release, deployment or production migration is authorized by this task.

## Checks

Planned validation order:

1. Generate candidate `package.json`, `pnpm-workspace.yaml` and `pnpm-lock.yaml` with pinned Node/pnpm in a read-only hosted runner.
2. Run package policy and high-severity audit against that candidate graph before committing it.
3. Commit the generated graph and remove the temporary resolver in the same final dependency change where practical.
4. Inspect the complete PR CI result; fix only evidence-backed regressions.
5. Keep PR #66 unmerged until required CI is completely green.

## Delivery

- Existing branch: `agent/security-ranked-integrity-reconciliation`
- Existing PR: `#66`
- No auxiliary PR.
- No merge, deployment, release, package publication or remote migration.

## Status

In progress. Dependency remediation is being validated; the existing security gate remains intentionally strict until a safe graph passes it.
