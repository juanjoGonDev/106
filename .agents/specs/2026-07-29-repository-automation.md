# Repository automation standardization

## Request

Audit the active GitHub Actions setup against `fastypest`, add generic cache and Dependabot automation, and open one PR without merging or deploying.

## Evidence

- Default branch: `main`.
- Stack: pnpm, Node.js, Supabase, and Playwright.
- The repository already has parallel quality, browser, visual-evidence, asset, Pages, and Supabase workflows, but no Dependabot configuration.
- Dependabot-triggered `pull_request_target` workflows receive a read-only token and no secrets, so privileged Dependabot automation must not depend on repository secrets.

## Decision

- Add grouped weekly npm and GitHub Actions updates after a seven-day cooldown.
- Use `pull_request` plus the repository-scoped `GITHUB_TOKEN` for Dependabot approval, labels, and auto-merge; no PR code is checked out.
- Require a current write-permission maintainer approval for production majors, bound to the current head SHA.
- Use the scheduled default-branch workflow and `GITHUB_TOKEN` for required-QA branch updates and auto-merge.
- Add cache-key-independent cleanup through the Actions cache API with manual dry-run by default.
- Keep dependency automation independent from the application quality critical path.
- Do not add release automation because delivery follows the existing Pages and Supabase contracts.

## Acceptance

- [x] No privileged workflow checks out pull-request-controlled code.
- [x] Dependency jobs remain outside the application quality pipeline.
- [x] External or stale approvals cannot unlock production majors.
- [x] Cache cleanup is global, bounded, and safe for empty/concurrent deletion.
- [x] No new repository secret or variable is required.
- [x] No application, database, release, or deployment behavior changes.

## Validation

The proposed YAML parsed successfully. Existing package scripts and workflow contracts were inspected. Pull-request CI remains the runtime gate.

## Repository settings

Enable repository auto-merge and `Allow GitHub Actions to create and approve pull requests`. Required status checks must remain enforced on `main`.

## Risks and rollback

The workflows cannot approve or queue pull requests if the repository settings above are disabled. Revert this PR to roll back; no runtime data requires recovery.

## Delivery

- Branch: `agent/chore-repository-automation`
- Base: `main`
- Merge/release/deploy/publish: not authorized

## Status

Implemented on the task branch; pull-request checks and repository settings remain to be verified.
