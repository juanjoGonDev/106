# Platform visual evidence standard

## Request

- Add a root `AGENTS.md` so repository-aware coding agents consistently follow the project workflow.
- Make remote visual review mandatory and reproducible for frontend and UX work.
- Produce one downloadable GitHub Actions ZIP containing complete Desktop/Mobile screenshots plus real WebM recordings and derived GIFs for maintained platform screens, states, actions and events.
- Keep one feature branch and one pull request per task; visual evidence must not create auxiliary branches or pull requests.

## Evidence

- The repository currently has no root `AGENTS.md`.
- `.github/pull_request_template.md` documents Desktop/Mobile/GIF evidence, but still permits `pr-evidence/<number>` branches.
- `.github/workflows/pr-visual-evidence.yml` duplicates validation in inline Python and only enforces Desktop/Mobile pairs, while `scripts/pr-visual-evidence.mjs` also requires GIF evidence.
- `.github/workflows/player-browser.yml` already generates `.tmp/pr-previews` and uploads it as an Actions artifact, which GitHub exposes as a downloadable ZIP.
- The latest complete browser artifact already covers the main game, rankings, account, player pages, sharing, achievements and league states, but it has no executable inventory or integrity manifest.
- Legal, privacy, cookies and privacy-settings surfaces are user-facing screens and are not yet part of the visual evidence inventory.

## Decision

1. Add a concise root `AGENTS.md` that routes visual work to `.agents/visual-evidence.md`, requires task specs, and forbids auxiliary evidence branches.
2. Define an executable platform inventory in `scripts/platform-evidence.mjs`:
   - every maintained screen/state requires one full-page Desktop PNG and one full-page Mobile PNG;
   - every maintained animated action/event requires Desktop/Mobile WebM and GIF pairs.
3. Extend Playwright evidence with legal, privacy, cookies and privacy-settings screenshots.
4. Validate the complete evidence directory after GIF generation and write `manifest.json` with file sizes and SHA-256 digests.
5. Upload the complete directory as `platform-evidence-<run-id>` with a 14-day retention period. The GitHub Actions artifact is the canonical downloadable ZIP.
6. Require frontend PR descriptions to include:
   - the canonical platform artifact URL;
   - inline Desktop/Mobile/GIF evidence for each changed visual area;
   - no `pr-evidence/*` branch URLs.
7. Keep the pull-request metadata validator non-executing and read-only for untrusted PR code while aligning its checks with the tested JavaScript contract.

## Scope

- Root and `.agents/` repository instructions.
- Pull-request template and evidence workflow policy.
- Platform evidence inventory, manifest generation and isolated 100% coverage.
- Browser evidence workflow naming, retention and artifact behavior.
- Static compliance-page Playwright screenshots.
- No production application behavior, database schema or Supabase function changes.

## Acceptance criteria

- [ ] Root `AGENTS.md` applies the one-branch/one-PR and visual evidence rules repository-wide.
- [ ] `.agents/visual-evidence.md` defines the complete remote review procedure.
- [ ] `pnpm preview:platform` generates evidence from the current checkout.
- [ ] Every required platform screen/state has complete Desktop and Mobile PNG files.
- [ ] Every required animated interaction has Desktop and Mobile WebM/GIF pairs.
- [ ] Evidence validation fails on missing or duplicate required files.
- [ ] The evidence directory contains a deterministic manifest with SHA-256 file digests.
- [ ] GitHub Actions uploads one canonical downloadable platform evidence ZIP.
- [ ] Frontend PR metadata requires the artifact link and changed-area Desktop/Mobile/GIF evidence.
- [ ] Evidence branches are rejected and no additional PR is created.
- [ ] New pure evidence logic has 100% line, function and branch coverage.
- [ ] CI is green on the final PR head.

## Validation

- `pnpm test:platform-evidence:coverage`
- `pnpm test:pr-visual-evidence:coverage`
- `pnpm check`
- `pnpm test:e2e`
- Pull Request Visual Evidence workflow
- Player Pages and Social Cards workflow and uploaded `platform-evidence-<run-id>` artifact inspection

## Risks

- The full platform ZIP can be large. Retention is bounded to 14 days and raw evidence remains outside Git.
- The executable inventory is intentionally strict. Adding or removing a platform screen or animated event requires updating its Playwright capture and inventory in the same PR.
- Metadata validation cannot reference an artifact before the browser workflow creates it. The agent must update the same PR body with the artifact URL after the run; it must not create another branch or PR.

## Rollback

Revert the documentation, scripts, tests and workflows. No database or production-data rollback is required. Existing generated Actions artifacts expire automatically.

## Delivery

- Branch: `agent/chore-visual-evidence-standard`
- Base: `main` at `3b5db484634436090cb4d2da8a9fffcc2bd1dc6b`
- Pull request: pending
- Merge/deployment: not authorized

## Status

Implementation in progress.
