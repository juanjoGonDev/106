# Social preview reliability and pull request visual evidence

## Request

Fix the missing X/Twitter card for the public site, regenerate social PNG output so no content is clipped, remove duplicated or unused public image assets, add CI coverage for public assets that Knip cannot resolve, and require desktop/mobile visual evidence for future frontend pull requests. Provide local tooling that captures screenshots and can assemble a GIF from deterministic Playwright frames without committing generated evidence.

## Evidence

- The root `index.html` pointed X/Twitter at `public/assets/social-preview-v2.png`, but that file was created only while tests ran and was not committed or deployed.
- `scripts/render-social-preview.mjs` wrote the same PNG to multiple roots (`assets`, `public/assets`, and `public/public/assets`), creating duplicate and ambiguous deployment paths.
- The player social card used content boxes whose declared widths excluded padding, allowing three metrics to exceed the available panel width in the Edge renderer.
- The player card template was fetched from a public URL at runtime, so a deployment-path mismatch silently fell back to a different template.
- Knip analyzes executable module graphs; it does not prove that static images referenced from HTML metadata, manifests, CSS strings, or Edge templates exist and are uniquely located.
- PR #14 contained frontend changes but the repository had no reusable PR visual-evidence template or deterministic capture command.
- Quality pipeline run `29970810646` confirmed the local Supabase stack, Edge Function, API journey, generated site/player PNG previews, Vitest, Knip, and security checks. Its only failing stage was ESLint on unsafe-regex findings in the visual-evidence parser.
- Player workflow run `29970810649` passed browser journeys, screenshot generation, asset checks, and all configured 100% coverage gates.

## Decision

- Serve both the site-wide and player-specific PNG cards from the public `player-share` Edge Function.
- Use a reserved `_site/card.png` route for the site-wide card and point both root HTML entrypoints directly at that stable public PNG endpoint.
- Store SVG templates beside the Edge Function and read them from the deployed function bundle instead of fetching them from GitHub Pages.
- Rebuild the player card with explicit safe-area coordinates, border-box sizing, bounded text, fixed metric widths, and no edge-aligned critical content.
- Delete generated static PNG duplicates and obsolete public templates.
- Add a repository asset auditor that validates public media references, rejects nested `public/public`, rejects root-level duplicate asset directories, and reports orphaned public media.
- Add a mandatory pull-request visual-evidence template and a read-only workflow that requires matched Desktop/Mobile `<details>` image pairs whenever frontend files change.
- Extend Playwright journeys to write deterministic desktop/mobile screenshots when `PR_VISUAL_CAPTURE=1`; optional frame capture is assembled into a GIF by the local preview command.
- Generated visual evidence lives under `.tmp/pr-previews`, is ignored by Git, and is uploaded only as CI artifacts or attached to the PR.
- Parse visual-evidence paths and Markdown destinations with bounded linear string operations instead of regular expressions rejected by the security lint policy.
- Pin PR evidence URLs to the temporary evidence commit, then remove the evidence wrappers from the final branch tree.

## Acceptance

- Sharing `https://juanjogondev.github.io/106/` exposes a committed HTML response whose `og:image` and `twitter:image` resolve to a public `image/png` endpoint.
- The site card and each player card return valid 1200x630 PNG files with bounded cache headers.
- Player card metrics, labels, radar, rows, and footer remain inside a 48 px minimum safe area.
- No tracked `assets/social-preview*.png`, `public/public`, obsolete generated social PNG, or temporary PR evidence file remains in the final tree.
- `pnpm check:public-assets` passes and is required by CI.
- Frontend PRs fail the visual-evidence workflow unless each documented area has both Desktop and Mobile Markdown images.
- `pnpm preview:pr` writes desktop/mobile screenshots outside Git; `pnpm preview:pr:gif` additionally creates a GIF from deterministic frames.
- Vitest, syntax, ESLint, Knip, security, Supabase integration, Playwright desktop/mobile, asset audit, visual-evidence validation, and the quality gate pass.

## Scope

- Static social metadata, the `player-share` Edge Function, social templates, public asset governance, Playwright evidence tooling, PR template, and CI.
- No changes to gameplay, captcha, timing, account ownership, attempt limits, or ranking calculations.

## Risks

- X/Twitter caches cards externally. A new image endpoint and versioned metadata avoid the missing asset, but previously cached posts may not refresh immediately.
- Local SVG reads must remain inside the Edge Function bundle; Supabase integration verifies both templates render after a clean local deployment.
- PR-body validation must never execute pull-request code or interpolate untrusted body text into a shell command.
- Visual artifacts can be large; CI retains them briefly and Git ignores the local output directory.
- Evidence URLs reference an immutable historical commit so deleting the temporary files from the branch tip does not break the PR description.

## Tests

- Static HTML contracts for exact Open Graph/Twitter image URLs and image dimensions.
- Asset audit unit/integration coverage against missing, duplicated, and orphaned media.
- Local Supabase requests for `_site/card.png` and player section cards, including PNG signature, 1200x630 IHDR dimensions, content type, and cache policy.
- Playwright desktop and Pixel 5 journeys with deterministic screenshots for the home, ranking, and player surfaces.
- PR-body validator unit tests for paired evidence, placeholders, non-frontend changes, malformed Markdown, and every linear-parser boundary.

## Validation

- Public Asset Audit run `29970810656`: success.
- Player Pages and Social Cards run `29970810649`: success, including desktop/mobile Playwright and 100% module coverage gates.
- Pull Request Quality Pipeline run `29970810646`: Supabase integration, Vitest, Knip, build, syntax, and security succeeded; the unsafe-regex ESLint finding was subsequently removed in commits `e4f2a10` and `20749ed`.
- PR #14 now contains paired Desktop/Mobile evidence pinned to commit `13d17446`.
- Temporary evidence files were removed from the branch tip in commits `aa78d5b` and `c30cbb9`.
- Final CI validation is required on the latest specification commit before delivery is marked complete.

## Rollback

Revert the pull request changes. Restore the previous public template and PNG generation only if the Edge image endpoint cannot be served; do not restore duplicate output roots.

## Delivery

- Branch: `agent/feat-player-pages-ranking-refresh`
- Pull request: `#14`
- Base: `main`
- No merge or deployment without explicit approval.

## Status

Implementation and PR evidence are complete. Final CI validation is in progress on the clean branch tip.
