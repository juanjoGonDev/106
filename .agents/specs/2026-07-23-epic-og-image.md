# Epic Open Graph image

## Request

Replace the generic site social card with an epic Open Graph image that creates rivalry and encourages entry into the game. The composition must explain the precision objective and present Spain against Argentina competing for the World Cup.

## Evidence

- The site already exposes a public `1200x630` PNG through the `player-share/_site/card.png` Edge Function.
- `supabase/functions/player-share/site-card-template.svg` is the visual source loaded by the renderer.
- The previous template provided a split background and safe area, but it did not create a strong final-match atmosphere or explicitly frame the rivalry around the World Cup.
- Both deployable HTML entrypoints reference the same dynamic image endpoint.
- Two existing metadata contract tests pinned the previous cache-busting version and failed after the intentional URL update.

## Decision

- Preserve the dynamic PNG architecture and replace only the bundled site-card SVG template.
- Use an original vector composition: night stadium, floodlights, Spain and Argentina colour fields, generic opposing footballers and a generic golden cup.
- Keep official federation and FIFA marks out of the asset.
- Preserve the existing renderer overlays, dimensions and explicit safe-area frame.
- Add the static line `POR LA COPA DEL MUNDO` to make the premise unambiguous.
- Bump the Open Graph image query version in both HTML entrypoints so social crawlers receive a new image URL.
- Update the exact metadata and sharing contract tests to the same version rather than weakening their assertions.

## Acceptance

- The template remains exactly `1200x630`.
- Spain and Argentina are visually opposed and remain readable under the existing overlay.
- The card communicates the `10.600` objective through the existing renderer overlay.
- The World Cup rivalry is explicit without using protected logos or a copy of the official trophy.
- The SVG renders successfully to PNG and retains all critical content inside the safe area.
- Both HTML entrypoints and their contract tests use the same new cache-busting image version.
- A normal pull request is opened from `agent/feat-epic-og-image` to `main`.

## Scope

- Site-wide social preview template.
- Open Graph and Twitter image cache version.
- Metadata and sharing contract tests.
- No gameplay, player-card, database or authentication changes.

## Risks

- Social platforms may retain the old image when the URL is unchanged; the metadata version bump mitigates this.
- The Edge Function must be deployed after merge before the new image is served.
- SVG filters vary between renderers; the composition uses standard primitives and was validated with a local PNG render.

## Validation

- Parsed `site-card-template.svg` successfully as XML.
- Rendered the complete card preview locally to PNG at exactly `1200x630`.
- Confirmed the explicit safe-area frame remains `x="32" y="32" width="1136" height="566"`.
- Confirmed the template contains the World Cup rivalry copy and no FIFA marks.
- Confirmed the existing `ImageResponse` renderer, PNG endpoint and overlay contract remain unchanged.
- Confirmed `index.html`, `public/index.html`, `tests/content-policy.test.js` and `tests/sharing-flow.test.js` all reference `card.png?v=20260723-2`.
- Initial CI failure was reproduced from the uploaded Vitest JSON report and traced to the two intentionally stale URL assertions; both exact contracts were updated.
- Pull Request Visual Evidence, Public Asset Audit and Player Pages and Social Cards passed before the contract-test correction; the complete pipeline reruns on the final head.

## Rollback

Revert the template, metadata version and matching contract-test commits. No data migration or runtime state rollback is required.

## Delivery

- Branch: `agent/feat-epic-og-image`
- Base: `main`
- Pull request: `#18`
- Merge and Supabase deployment are not part of this task.

## Status

Implemented; final CI validation in progress.
