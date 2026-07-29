# Dependabot major update policy

## Status

Ready for review.

## Request

Prevent every semantic-version major Dependabot update from being approved or queued automatically. Patch and minor updates may retain the existing owner-approval and expected-head auto-merge flow.

## Evidence

The previous workflow marked development-only major updates as eligible. Open GitHub Actions majors demonstrate that dependency type is not a sufficient risk boundary.

## Decision

Classify only patch and minor updates as eligible. Classify every major update as requiring manual QA, independent of dependency type. Keep the existing actor separation: the owner PAT approves eligible updates and `github-actions[bot]` queues expected-head squash auto-merge.

## Acceptance criteria

- Patch and minor updates remain eligible.
- Every major update receives `requires-manual-qa` and is not auto-approved or queued.
- Unknown update types are ignored safely.
- The classification step exercises patch, minor, major and unknown contract cases before processing the event.
- Workflow permissions remain least-privilege.

## Validation

- Public Asset Audit run `30471193449`: success.
- Pull Request Visual Evidence run `30471200397`: success.
- Authentication Quality run `30471192899`: success.
- Player Pages and Social Cards run `30471187792`: success.
- Pull Request Quality Pipeline run `30471187717`: success after one evidence-based retry of a local PostgREST readiness failure.
- The Dependabot job is skipped as expected because this corrective PR is owner-authored.
- Existing major PRs are labeled `requires-manual-qa`; stale automated approvals on majors were dismissed.

## Delivery

Branch: `agent/fix-dependabot-major-policy`.
Pull request: `#51`.

## Rollback

Revert the workflow and this specification.
