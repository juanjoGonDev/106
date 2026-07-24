# Profile card attachment sharing

## Request

Make profile sharing reliably include the current generated player card together with the text and unchanged public profile URL. While the card is being prepared, the visible button copy must be exactly `Preparando...`. Remove obsolete preview workarounds and update real browser tests.

## Evidence

- The generated profile PNG already exists at the versioned `player-share` endpoint and reflects `profileRevision`.
- GitHub Pages serves clean `/player/<nick>` navigation through its static fallback, so a crawler cannot receive player-specific Open Graph metadata from that route.
- Adding a generic static `og:image` to `player.html` only produced a generic game preview, not the current player card.
- The Web Share API can pass a `File` alongside title and text. File support must be checked with `navigator.canShare({ files })`, and the native share call must happen directly from the user gesture.
- The existing application share surface already provides text-and-URL fallbacks for browsers or targets that cannot accept files.
- During the original investigation, the dependency audit also identified `GHSA-r28c-9q8g-f849`; the branch already pins the patched `postcss@8.5.19` graph and preserves failed audit JSON.

## Decision

1. Keep the canonical public URL `/106/player/<nick>` in profile share copy.
2. Preload the current versioned player PNG as a browser `File` before enabling the share button.
3. Show `Preparando...` and disable the button until preparation succeeds or fails.
4. On supported devices, invoke native sharing with the PNG file and a text field containing both the profile copy and public URL.
5. On unsupported devices or preparation failure, reuse the existing text-and-URL share flow.
6. Treat user cancellation as a normal non-share and do not open an additional fallback dialog.
7. Apply the same behavior to the dedicated player page and the authenticated player's honours surface.
8. Remove the generic static player Open Graph workaround from `player.html`; runtime metadata and the internal PNG renderer remain available.
9. Keep the local server's GitHub Pages-compatible clean-route status behavior because it documents the static-hosting boundary accurately.
10. Keep the PostCSS remediation and dependency-audit diagnostics because they are independent security corrections.

## Scope

- `public/profile-share.js`
- `public/player.html`
- `public/player-ui.js`
- `public/player.js`
- `public/honours.js`
- package and Knip entrypoint registration
- focused unit and contract tests
- desktop/mobile Playwright sharing journeys
- existing security remediation in this pull request

## Acceptance

- The profile share button displays `Preparando...` and is disabled while the PNG is loading.
- The honours share button follows the same state contract.
- A supported native share receives exactly one `image/png` file generated from the current `profileRevision` URL.
- The native file share text includes the public clean profile URL and does not expose Supabase or `/functions/` URLs.
- The public profile URL remains `/player/<nick>` rather than `player.html?nick=...`.
- Unsupported file sharing falls back to the existing title, text and URL path.
- Failed PNG preparation does not strand the button in a disabled state.
- Cancelling the native share does not produce an error or secondary dialog.
- The generic static profile Open Graph image is removed.
- Unit, contract, desktop and mobile browser tests cover the real file payload and fallback.
- Package policy, syntax, ESLint, Knip, Vitest, dependency audit and Supabase integration remain green.

## Risks

- Some share targets may choose how to present or combine the supplied fields. The URL is therefore included in the text for the file-sharing path.
- Desktop browsers commonly lack file sharing support; they intentionally retain the existing text-and-URL dialog.
- A failed or unavailable PNG request degrades to text and URL rather than blocking profile sharing.
- The player image endpoint remains internal infrastructure and is never placed in user-visible share text.
- Pull request `#30` overlaps player and honours files and will require rebasing after this pull request if both remain open.

## Tests

- Vitest executes the file preparation, filename normalization, `canShare`, native payload, cancellation, native failure and fallback contracts.
- Node coverage continues to validate canonical player URL and versioned card URL construction.
- Contract tests verify the generic static player preview has been removed and both profile surfaces use the attachment helper.
- Playwright delays the real PNG response, verifies `Preparando...` and disabled state, releases the response, then inspects the serialized native file payload on desktop and mobile projects.
- A second Playwright journey verifies the no-file-support fallback sends the original text and clean URL.

## Rollback

Revert this branch. No schema, migration, persisted data, production secret or permission change is introduced by the attachment flow.

## Delivery

- Branch: `agent/fix-profile-share-preview`
- Pull request: `#29`
- Base: `main`
- Normal pull request; no merge or deployment without explicit authorization.

## Status

Implementation complete. Final CI is authoritative for merge readiness.
