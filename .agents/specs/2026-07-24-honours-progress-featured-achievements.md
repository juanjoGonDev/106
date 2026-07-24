# Honours progress and featured achievements

## Request

Show both earned and locked trophies and achievements on public player profiles. Locked entries must look unavailable and expose concrete progress toward the next unlock. Let the authenticated owner select, replace and clear up to three distinct unlocked achievements as profile highlights, and render those highlights in the generated profile image.

## Evidence

- `public/player.js` previously rendered only persisted trophy history and unlocked achievement rows.
- The previous public profile contract exposed earned achievements but no progress metrics, no trophy challenge state and no owner-managed highlights.
- `player-share` selected the first three earned items instead of an explicit player choice.
- `player-context` already established whether the current account owns a nickname without creating or claiming an account, making it the correct write boundary.
- Profile images use `profileRevision` as their cache key, so highlight changes must advance that revision.
- A newly published high-severity advisory, `GHSA-mh99-v99m-4gvg`, marked transitive `brace-expansion@5.0.7` as vulnerable to denial of service through unbounded expansion length.

## Decision

1. Add an append-only selection table with soft activation, ordered positions one through three and a partial uniqueness invariant per active slot.
2. Accept only distinct, already unlocked achievement codes and reject more than three selections.
3. Keep the mutation RPC callable only by `service_role`; `player-context` verifies account ownership before invoking it.
4. Extend the public profile with ordered `achievements.featured` items and `honoursProgress` metrics derived from authoritative trophy and achievement rules.
5. Advance `profileRevision` when highlights change so social-card URLs invalidate immediately.
6. Keep achievement definitions and presentation rules in one browser catalogue module. Contract tests compare its thresholds and codes with the database migration.
7. Render locked rows with reduced contrast, grayscale and explicit progress text/bars while retaining accessible labels and readable descriptions.
8. Show the selected achievements prominently on the profile overview and prioritize them in generated overview and achievement images.
9. Provide the editor only when `player-context` reports `availability: owned`; public visitors remain read-only.
10. Serialize highlight replacement per nickname with a transaction-scoped advisory lock before deactivating active slots.
11. Override the vulnerable transitive package with exact `brace-expansion@5.0.8`, record the security-only release-age exception and retain frozen lockfile installation.

## Scope

- Forward-only Supabase migrations for highlight storage, mutation RPC, progress metrics, profile projection and featured ordering.
- `player-context` mutation action with ownership and input validation.
- Shared client-side honours catalogue.
- Public profile overview, achievement collection, trophy collection and highlight editor.
- Generated player image routing and featured ordering.
- Contract, unit, Supabase integration and responsive Playwright coverage.
- Audited dependency override and regenerated exact lockfile.

## Acceptance

- [x] Trophy and achievement sections display earned and locked entries.
- [x] Every locked deterministic milestone displays current, target, remaining value and a progress bar.
- [x] Trophy cards explain today's Bota, Guante and Balón progress using the current Madrid-day standings.
- [x] Locked entries are visually distinct without hiding their name, requirement or progress from assistive technology.
- [x] Only an account owning the nickname can modify highlights.
- [x] Selections contain at most three distinct unlocked achievement codes.
- [x] Replacing, reordering or clearing highlights is atomic, serialized and idempotent.
- [x] Selected achievements appear prominently on the public overview and achievement collection.
- [x] Generated profile and achievement images prioritize the selected achievements.
- [x] Highlight changes advance `profileRevision` and therefore the generated image URL.
- [x] Existing public profile reads remain anonymous and secret-free.
- [x] Frozen installation resolves `brace-expansion@5.0.8` and `pnpm audit` reports no high-severity vulnerability.
- [x] Syntax, lint, dead-code, unit, security, Supabase integration and desktop/mobile browser checks pass.

## Risks

- A duplicated browser catalogue can drift from backend unlock rules. Mitigation: thresholds are explicit and contract-tested against migration constants.
- Replacing active selections could violate slot uniqueness under concurrent writes. Mitigation: a player-scoped advisory transaction lock serializes replacement before soft deactivation and ordered upsert; the partial unique index remains the database invariant.
- Public progress calculations could leak private league credentials. Mitigation: the projection exposes aggregate counts and public ranking state only; no join codes or account identifiers.
- Cached social images could remain stale. Mitigation: highlight update timestamps participate in `profileRevision`.
- `brace-expansion@5.0.8` was published inside the normal seven-day maturity window. Mitigation: the exception is exact, advisory-specific, transitive-only, integrity-locked and validated by frozen install plus `pnpm audit`; remove the exception after the normal window.

## Tests

- Catalogue unit tests cover earned/locked ordering, count milestones, lower-is-better precision milestones, daily trophy objectives and max-three normalization.
- Contract tests cover the service-role-only table and RPC boundary, owner verification, generated-card route and highlighted ordering.
- Supabase integration tests exercise ordered selection, replacement, clearing, revision changes and rejection of limits, duplicates and locked codes.
- A concurrency regression contract requires the advisory lock before active-slot deactivation.
- Responsive Playwright journeys verify locked progress, the owner-only editor, exactly three selections, disabled fourth selection, persistence and highlighted rendering on desktop and mobile.
- Package policy, frozen installation and dependency audit validate the exact patched transitive graph.
- Existing player navigation, player pages, public assets, syntax, ESLint, Knip, dependency/security and social-card suites remain green.

## Rollback

Revert application reads and mutation routing if necessary. Keep persisted highlight rows and progress-compatible schema. Any schema correction must be a new additive migration; do not rewrite or remove applied migrations. Revert the dependency override only after the upstream dependency graph no longer resolves a vulnerable `brace-expansion` version.

## Validation

Implementation and dependency-security head `0cbe418cc7d3fc74f7409db52726f4b362728c89`:

- Pull Request Quality Pipeline `30134415197`: frozen installation, build, syntax, Vitest, ESLint, Knip, dependency audit, security policy, clean Supabase rebuild, API integration, generated social previews and Quality Gate passed.
- Player Pages and Social Cards `30134415191`: desktop/mobile Playwright journeys and strict frontend module coverage passed.
- Pull Request Visual Evidence `30134415187`: passed.
- Public Asset Audit `30134415192`: passed.
- Diagnostic audit identified only `GHSA-mh99-v99m-4gvg`; regenerated lockfile validation resolved it with `brace-expansion@5.0.8` and the temporary repair workflow was removed from the final tree.

## Delivery

- Branch: `agent/feat-competitive-progression`.
- Pull request: `#30`.
- Implementation validation head: `0cbe418cc7d3fc74f7409db52726f4b362728c89`.
- No merge, deployment or production migration performed.

## Status

Completed and validated. Pending review, merge and deployment authorization.
