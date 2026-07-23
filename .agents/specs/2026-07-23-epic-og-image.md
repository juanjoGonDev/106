# Epic Open Graph image

## Request

Replace the generic site social card with an epic Open Graph image that creates rivalry and encourages entry into the game. The composition must explain the precision objective and present Spain against Argentina competing for the World Cup.

## Evidence

- The site already exposes a public `1200x630` PNG through the `player-share/_site/card.png` Edge Function.
- `supabase/functions/player-share/site-card-template.svg` is the visual source loaded by the renderer.
- The current template provides a split background and safe area, but it does not create a strong final-match atmosphere or explicitly frame the rivalry around the World Cup.
- Both deployable HTML entrypoints reference the same dynamic image endpoint.

## Decision

- Preserve the dynamic PNG architecture and replace only the bundled site-card SVG template.
- Use an original vector composition: night stadium, floodlights, Spain and Argentina colour fields, generic opposing footballers and a generic golden cup.
- Keep official federation and FIFA marks out of the asset.
- Preserve the existing renderer overlays, dimensions and explicit safe-area frame.
- Add the static line `POR LA COPA DEL MUNDO` to make the premise unambiguous.
- Bump the Open Graph image query version in both HTML entrypoints so social crawlers receive a new image URL.

## Acceptance

- The template remains exactly `1200x630`.
- Spain and Argentina are visually opposed and remain readable under the existing overlay.
- The card communicates the `10.600` objective through the existing renderer overlay.
- The World Cup rivalry is explicit without using protected logos or a copy of the official trophy.
- The SVG renders successfully to PNG and retains all critical content inside the safe area.
- Both HTML entrypoints use the same new cache-busting image version.
- A normal pull request is opened from `agent/feat-epic-og-image` to `main`.

## Scope

- Site-wide social preview template.
- Open Graph and Twitter image cache version.
- No gameplay, player-card, database or authentication changes.

## Risks

- Social platforms may retain the old image when the URL is unchanged; the metadata version bump mitigates this.
- The Edge Function must be deployed after merge before the new image is served.
- SVG filters vary between renderers; the composition uses standard primitives and is validated with a local PNG render.

## Validation

- Render the SVG locally at `1200x630`.
- Check SVG syntax and required safe-area marker.
- Confirm the existing `ImageResponse` renderer and image dimensions remain unchanged.
- Confirm both HTML entrypoints reference the new image version.
- Inspect the final PNG at full size and social-card scale.

## Rollback

Revert the template and metadata version commits. No data migration or runtime state rollback is required.

## Delivery

- Branch: `agent/feat-epic-og-image`
- Base: `main`
- Merge and Supabase deployment are not part of this task.

## Status

In progress.
