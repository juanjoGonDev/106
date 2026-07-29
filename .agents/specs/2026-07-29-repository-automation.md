# Repository automation standardization

## Request

Audit the active GitHub Actions setup against `fastypest`, add generic cache and Dependabot automation, and open one PR without merging or deploying.

## Evidence

- Default branch: `main`.
- Stack: pnpm, Node.js, Supabase, and Playwright.
- The repository already has parallel quality, browser, visual-evidence, asset, Pages, and Supabase workflows, but no Dependabot configuration.
- New automation must remain independent from untrusted checkout and must not extend the existing quality critical path.

## Decision

- Add grouped weekly npm and GitHub Actions updates after a seven-day cooldown.
- Add cache-key-independent cleanup through the Actions cache API with manual dry-run by default.
- Auto-approve patch/minor updates and development-only majors without checking out PR code. Production majors require a current approval from a reviewer with repository write permission.
- Resolve the default branch dynamically, pin introduced Actions by immutable SHA, and use read-only default permissions.
- Require `REPOSITORY_AUTOMATION_TOKEN`, with `PAT_FINE` as fallback, only for privileged write operations.
- Do not add release automation because delivery follows the existing Pages and Supabase contracts.

## Acceptance

- [x] No privileged workflow executes pull-request-controlled code.
- [x] Dependency jobs remain outside the application quality pipeline.
- [x] External or stale approvals cannot unlock production majors.
- [x] Cache cleanup is global, bounded, and safe for empty/concurrent deletion.
- [x] No application, database, release, or deployment behavior changes.

## Validation

The proposed YAML parsed successfully. Existing package scripts and workflow contracts were inspected. Pull-request CI remains the runtime gate.

## Risks and rollback

Repository auto-merge, branch protection, and an appropriately scoped token are required for writes. Revert the workflow and Dependabot commits to roll back; no runtime data requires recovery.

## Delivery

- Branch: `agent/chore-repository-automation`
- Base: `main`
- Merge/release/deploy/publish: not authorized

## Status

Implemented on the task branch; pull-request checks and repository settings remain to be verified.
