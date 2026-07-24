# Honours progress and featured achievements

## Request

Show both earned and locked trophies and achievements on public player profiles. Locked entries must look unavailable and expose concrete progress toward the next unlock. Let the authenticated owner select, replace and clear up to three distinct unlocked achievements as profile highlights, and render those highlights in the generated profile image.

## Evidence

- `public/player.js` currently renders only persisted trophy history and unlocked achievement rows.
- The public profile contract exposes earned achievements but no progress metrics, no trophy challenge state and no owner-managed highlights.
- `player-share` always selects the first three earned items instead of an explicit player choice.
- `player-context` already establishes whether the current account owns a nickname without creating or claiming an account, making it the correct write boundary.
- Profile images use `profileRevision` as their cache key, so highlight changes must advance that revision.

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

## Scope

- Forward-only Supabase migration for highlight storage, mutation RPC, progress metrics and profile projection.
- `player-context` mutation action with ownership and input validation.
- Shared client-side honours catalogue.
- Public profile overview, achievement collection, trophy collection and highlight editor.
- Dynamic player image highlight rendering.
- Contract, unit, Supabase integration and responsive Playwright coverage.

## Acceptance

- [ ] Trophy and achievement sections display earned and locked entries.
- [ ] Every locked deterministic milestone displays current, target, remaining value and a progress bar.
- [ ] Trophy cards explain today's Bota, Guante and Balón progress using the current Madrid-day standings.
- [ ] Locked entries are visually distinct without hiding their name, requirement or progress from assistive technology.
- [ ] Only an account owning the nickname can modify highlights.
- [ ] Selections contain at most three distinct unlocked achievement codes.
- [ ] Replacing, reordering or clearing highlights is atomic and idempotent.
- [ ] Selected achievements appear prominently on the public overview and achievement collection.
- [ ] Generated profile and achievement images prioritize the selected achievements.
- [ ] Highlight changes advance `profileRevision` and therefore the generated image URL.
- [ ] Existing public profile reads remain anonymous and secret-free.
- [ ] Syntax, lint, dead-code, unit, security, Supabase integration and desktop/mobile browser checks pass.

## Risks

- A duplicated browser catalogue can drift from backend unlock rules. Mitigation: keep thresholds explicit, small and contract-tested against migration constants.
- Replacing active selections could violate slot uniqueness mid-transaction. Mitigation: deactivate current rows before ordered upserts and enforce a partial unique index only for active rows.
- Public progress calculations could leak private league credentials. Mitigation: expose aggregate counts and public ranking state only; no join codes or account identifiers.
- Cached social images could remain stale. Mitigation: include highlight update timestamps in `profileRevision`.

## Rollback

Revert application reads and mutation routing if necessary. Keep persisted highlight rows and progress-compatible schema. Any schema correction must be a new additive migration; do not rewrite or remove applied migrations.

## Validation

Pending implementation and CI evidence.

## Delivery

- Branch: `agent/feat-competitive-progression`.
- Pull request: `#30`.
- No merge, deployment or production migration without explicit authorization.

## Status

Implementation in progress.
