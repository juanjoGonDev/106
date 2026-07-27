# Platform visual evidence standard

## Request

- Add a root `AGENTS.md` so repository-aware coding agents consistently follow the project workflow.
- Make remote visual review mandatory and reproducible for frontend and UX work.
- Produce one downloadable GitHub Actions ZIP containing complete Desktop/Mobile screenshots plus real WebM recordings and derived GIFs for maintained platform screens, states, actions and events.
- Keep one feature branch and one pull request per task; visual evidence must not create auxiliary branches or pull requests.

## Evidence

Before this change:

- The repository had no root `AGENTS.md`.
- `.github/pull_request_template.md` documented Desktop/Mobile/GIF evidence but still permitted auxiliary evidence branches.
- `.github/workflows/pr-visual-evidence.yml` duplicated validation in inline Python and only enforced Desktop/Mobile pairs, while `scripts/pr-visual-evidence.mjs` also required GIF evidence.
- `.github/workflows/player-browser.yml` generated `.tmp/pr-previews` and uploaded it as an Actions artifact, but the artifact had no executable platform inventory or integrity manifest.
- Legal, privacy, cookies and privacy-settings surfaces were user-facing screens outside the visual evidence inventory.
- The cookies table overflowed and was difficult to read on a mobile viewport; adding the compliance surfaces to the inventory exposed the regression.

## Decision

1. Add a concise root `AGENTS.md` that routes visual work to `.agents/visual-evidence.md`, requires task specs, and forbids auxiliary evidence branches.
2. Define an executable platform inventory in `scripts/platform-evidence.mjs`:
   - every maintained screen/state requires one full-page Desktop PNG and one full-page Mobile PNG;
   - every maintained animated action/event requires Desktop/Mobile WebM and GIF pairs.
3. Extend Playwright evidence with legal, privacy, cookies and privacy-settings screenshots.
4. Record a complete Desktop/Mobile cookies-page journey so the responsive compliance change has matching PNG, WebM and GIF evidence.
5. Validate the complete evidence directory after GIF generation and write `manifest.json` with file sizes and SHA-256 digests.
6. Bind the manifest to `github.event.pull_request.head.sha`, not the synthetic pull-request merge commit.
7. Upload the complete directory as `platform-evidence-<run-id>` with a 14-day retention period. The GitHub Actions artifact is the canonical downloadable ZIP.
8. Require frontend PR descriptions to include:
   - the canonical platform artifact URL;
   - inline Desktop/Mobile/GIF evidence for each changed visual area;
   - no auxiliary evidence-branch URLs.
9. Keep the pull-request metadata validator non-executing and read-only for untrusted PR code while aligning its checks with the tested JavaScript contract.
10. Render the cookies table as responsive cards below 700 px so the new full-platform evidence remains readable without horizontal overflow.

## Scope

- Root and `.agents/` repository instructions.
- Pull-request template and evidence workflow policy.
- Platform evidence inventory, manifest generation and isolated 100% coverage.
- Browser evidence workflow naming, retention and artifact behavior.
- Static compliance-page Playwright screenshots and the cookies-page scroll recording.
- Responsive legal/cookies presentation required by the newly enforced mobile evidence journey.
- No database schema, production data or Supabase function changes.

## Acceptance criteria

- [x] Root `AGENTS.md` applies the one-branch/one-PR and visual evidence rules repository-wide.
- [x] `.agents/visual-evidence.md` defines the complete remote review procedure.
- [x] `pnpm preview:platform` generates evidence from the current checkout.
- [x] Every required platform screen/state has complete Desktop and Mobile PNG files.
- [x] Every required animated interaction has Desktop and Mobile WebM/GIF pairs.
- [x] Evidence validation fails on missing or duplicate required files.
- [x] The evidence directory contains a deterministic manifest with SHA-256 file digests.
- [x] The manifest records the pull-request head SHA.
- [x] GitHub Actions uploads one canonical downloadable platform evidence ZIP.
- [x] Frontend PR metadata requires the artifact link and changed-area Desktop/Mobile/GIF evidence.
- [x] Evidence branches are rejected and no additional PR is created.
- [x] New pure evidence logic has 100% line, function and branch coverage.
- [x] The cookies/legal surface is readable without horizontal overflow on the mobile browser project.
- [x] The cookies-page responsive change has Desktop/Mobile PNG, WebM and GIF evidence.

## Validation

Validated implementation head: `184aaf7b822296a46e49a9bbc4da2cbf0504effd`.

- `Pull Request Quality Pipeline` run `30222574011`: success.
- `Player Pages and Social Cards` run `30222573996`: success.
- `Public Asset Audit` run `30222574017`: success.
- Platform and PR evidence decision modules: 100% lines, functions and branches.
- Desktop and Mobile Playwright projects: success.
- Generated artifact: `platform-evidence-30222573996`.
- Artifact contents: 100 files, 32 screenshot areas and 6 recorded interaction areas.
- Manifest `commitSha`: `184aaf7b822296a46e49a9bbc4da2cbf0504effd`.
- Independent SHA-256 verification of all 100 manifest entries: zero mismatches.
- Cookies evidence includes `cookies-page-{desktop,mobile}.{png,webm,gif}`.
- Mobile cookies screenshot inspected after the responsive table fix: complete content, readable cards and no horizontal overflow.

The PR body is populated with the canonical artifact link and matching cookies Desktop/Mobile/GIF evidence before the final synchronization run. The final documentation head must pass the same workflows and publish its own head-bound artifact before the PR is reported ready.

## Risks

- The full platform ZIP is large. Retention is bounded to 14 days and raw evidence remains outside Git.
- The executable inventory is intentionally strict. Adding or removing a platform screen or animated event requires updating its Playwright capture and inventory in the same PR.
- Metadata validation cannot reference an artifact before the browser workflow creates it. The agent updates the same PR body after the run; it must not create another branch or PR.
- A full-platform run costs more CI time than changed-area-only capture. The stronger regression coverage and remote review contract justify the cost for frontend PRs.

## Rollback

Revert the documentation, scripts, tests, workflows and responsive legal-table styles. No database or production-data rollback is required. Existing generated Actions artifacts expire automatically.

## Delivery

- Branch: `agent/chore-visual-evidence-standard`
- Base: `main` at `3b5db484634436090cb4d2da8a9fffcc2bd1dc6b`
- Pull request: `https://github.com/juanjoGonDev/106/pull/38`
- Validated implementation artifact: `https://github.com/juanjoGonDev/106/actions/runs/30222573996/artifacts/8637676971`
- Branches/PRs used: one branch and one pull request.
- Merge/deployment: not authorized.

## Status

Implemented and validated on the implementation head. The PR metadata is populated before the final synchronization run; final-head CI and the head-bound artifact are the remaining delivery checks. Merge and deployment remain explicitly out of scope.
