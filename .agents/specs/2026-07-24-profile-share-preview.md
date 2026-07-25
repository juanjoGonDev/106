# Profile card attachment sharing

## Request

Make profile sharing reliably include the current generated player card together with the text and unchanged public profile URL. While the card is being prepared, the visible button copy must be exactly `Preparando...`. Reconcile the implementation with the competitive progression, featured-achievement and player-context changes already merged into `main`, and audit the newer result, referral, duel and public-league links for regressions.

## Evidence

- The generated profile PNG already exists at the versioned `player-share` endpoint and reflects `profileRevision`.
- GitHub Pages serves clean `/player/<nick>` navigation through its static fallback, so crawlers cannot receive player-specific Open Graph HTML from that route.
- A generic static `og:image` can only show a generic game image, not the current player card.
- The Web Share API can pass a `File` alongside title and text. Support must be checked with `navigator.canShare({ files })`.
- `main` now includes featured achievements, locked honour progress, public league URLs, resilient `player-context` loading and a silent public-profile fallback.
- `share-actions.js` owns canonical result, referral, direct-challenge and selected-league URLs. Those URLs must remain untouched by the profile-file enhancement.

## Decision

1. Keep canonical public profile URLs such as `/106/player/<nick>` and `/106/player/<nick>/trophies` in share copy.
2. Preload the exact section-specific, `profileRevision`-versioned player PNG before enabling profile or honours sharing.
3. Show `Preparando...` and disable the relevant button until image preparation succeeds or fails.
4. Install a small progressive-enhancement bridge around the existing `Minuto106UI.share` surface instead of duplicating or replacing the current player-page controller.
5. Attach the prepared PNG only when the payload URL matches a prepared public profile URL.
6. Keep result, referral, duel and public-league URLs on their existing text-and-URL flows.
7. On unsupported devices or image preparation failure, call the original share surface with title, text and canonical URL.
8. Treat native share cancellation as a normal cancellation without opening a secondary dialog.
9. Preserve the latest `main` implementation of `player.js`, `share-actions.js`, the public league routes, featured achievements and CORS-safe profile context.
10. Keep runtime Open Graph metadata as browser metadata only; do not reintroduce a generic static player image.

## Scope

- `public/profile-share.js`
- `public/player.html`
- `public/honours.js`
- package and Knip entrypoint registration
- focused unit and contract tests
- desktop/mobile Playwright profile-sharing journeys
- merge reconciliation with current `main`

## Acceptance

- [x] The public player share button starts disabled with `Preparando...`.
- [x] The authenticated honours button follows the same state contract.
- [x] A supported native share receives exactly one `image/png` file generated from the current section and `profileRevision` URL.
- [x] Native file-share text includes the clean public profile URL and excludes Supabase and `/functions/` URLs.
- [x] Overview, achievements and trophies profile sections retain their canonical clean routes.
- [x] Unsupported file sharing falls back to the existing title, text and URL path.
- [x] Failed PNG preparation does not leave a button disabled.
- [x] Cancelling native sharing does not produce an error or secondary dialog.
- [x] Featured-achievement changes trigger a new card preparation through `profileRevision`.
- [x] Result, referral, direct-challenge and public-league URLs remain unchanged.
- [x] The current CORS-safe `player-context` and silent public fallback remain intact.
- [x] Final package policy, syntax, ESLint, Knip, Vitest, dependency audit, Supabase integration and desktop/mobile browser workflows are green.

## Risks

- Share targets decide how to present supplied text and files. The clean URL is therefore included directly in the text of file shares.
- Desktop browsers commonly lack file-sharing support and intentionally retain the existing share dialog.
- The generated image request can fail or be blocked. The flow degrades to text and URL instead of blocking sharing.
- A global share wrapper could accidentally affect unrelated links. Mitigation: files are stored and selected only by exact normalized public profile URL; other routes have no prepared file.
- Re-rendered honours must invalidate stale files. Mitigation: the render signature includes `profileRevision`, performance aggregates and featured achievements.
- Repeated DOM observations could restart image preparation. Mitigation: exact URL/card signatures share one pending promise, cache one completed file and retain a failed state until the card signature changes.

## Tests

- Vitest covers filename normalization, PNG validation, native payloads, cancellation, native failure, unsupported file sharing, button lifecycle, exact-URL bridging, cache reuse, duplicate observer binding and preparation failure.
- Contract tests verify the latest player sections, current `player.js` metadata, the progressive-enhancement bridge, public league support and canonical share routes.
- Playwright delays a real PNG response, verifies the disabled `Preparando...` state, shares the trophies-section file, and inspects the native payload on desktop and mobile projects.
- A second browser journey verifies the text-and-URL fallback when file sharing is unsupported.
- Existing player-context browser tests remain authoritative for account headers, owner controls and silent public fallback.

## Validation

Final implementation head before this documentation-only closure was `63e352d8d8ec1663ab28c79ca9f6b918be842e0e`:

- Pull Request Quality Pipeline `30157461137`: build, frozen install, syntax, Vitest, ESLint, Knip, dependency audit, package/security policy, local Supabase integration and Quality Gate succeeded.
- Player Pages and Social Cards `30157461198`: strict frontend coverage and all desktop/mobile browser journeys succeeded.
- Public Asset Audit `30157461090`: succeeded.
- Pull Request Visual Evidence `30157461153`: succeeded.

The documentation-only closure commit must pass the same required PR checks before merge readiness is final.

## Rollback

Revert the merge reconciliation and follow-up sharing commits. No schema, migration, persisted data, production secret or permission change is introduced by the attachment flow.

## Delivery

- Branch: `agent/fix-profile-share-preview`
- Pull request: `#29`
- Base: current `main`
- Normal pull request; no merge or deployment without explicit authorization.

## Status

Implementation complete and reconciled with current `main`. The implementation head is fully green; final documentation-head CI confirmation is pending.
