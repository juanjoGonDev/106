# Mobile awards and compact ranking layout

## Request

Keep the daily awards visible on phones directly below the Spain-versus-Argentina score while preserving the desktop right rail. Rework the desktop home ranking so every entry uses two rows: rank, flag and nick on the first row; time and difference on the second row. Remove the nested visual container and the horizontal hover movement.

## Evidence

- `public/layout.js` moves `#awardsCard` into the right rail for every viewport.
- `public/v4.css` hides `.awards-card` at widths up to 500px, so phone users cannot see the daily awards.
- `public/ranking-enhancements.js` already refreshes the same awards DOM nodes after `minuto106:attempt-finished`, so moving the existing card preserves live updates without duplicating state.
- `public/v11.css` and the previous `public/v12.css` apply visual surfaces to both the list item and its link, creating a nested card effect.
- Both the list item and link apply `translateX` on hover, which shifts ranking content horizontally.
- The previous compact ranking puts nick, flag, time and difference on one row, which does not fit the narrow desktop rail reliably.

## Decision

- Extend `public/home-ranking-density.js`, which already runs after the three-column layout is built, to move the existing awards card after `.battle-card` at widths up to 700px and restore it as the first item in the right rail above that breakpoint.
- Keep one awards card and one set of award IDs; do not clone markup or introduce a second refresh path.
- Render ranking identity as flag plus nick on row one, with time and difference on row two.
- Keep the country available as the flag image alternative text and remove visible country copy from the compact ranking.
- Make the anchor the only visual row surface. Reset the list item background, border, outline, transform and transition.
- Remove every horizontal hover transform while retaining a background response and visible keyboard focus.

## Acceptance

- At viewport widths up to 700px, daily awards appear immediately below the global score card.
- Above 700px, daily awards remain in the right rail before the competition card.
- Awards continue to refresh after each successful attempt through the existing attempt-finished event.
- Each ranking row displays rank, flag and nick on the first line, with time and difference on the second line.
- Country names are not visibly repeated; each flag has a meaningful `alt` value.
- Each ranking entry has one visual container and does not move horizontally on hover or focus.
- Keyboard focus remains visible and the entire row remains the profile link.

## Scope

- Home-page responsive awards placement.
- Home-page compact ranking markup and styles.
- Regression tests for the responsive and presentation contracts.
- No API, database, scoring, account, league or deployment changes.

## Risks

- The responsive placement depends on the existing `.battle-card` and `.layout-rail--right` selectors; tests pin that contract.
- Moving a live DOM node across columns must not clone or replace it, otherwise award refresh listeners and IDs could diverge.
- CSS rules from earlier versioned stylesheets remain in the cascade; the final stylesheet must explicitly neutralize their transforms and nested surfaces.

## Validation

- Updated the existing unit contract for the two-row ranking, responsive awards placement, accessible flags and retained attempt-finished refresh path.
- Updated the Playwright journey to verify mobile DOM placement, desktop rail restoration, row geometry, a single transparent list-item wrapper, no horizontal hover movement and no page overflow.
- Visually inspected generated desktop and mobile previews: the desktop rail uses one stable two-row surface and the mobile awards card immediately follows the global score.
- Pull Request Quality Pipeline run `409` passed, including syntax, ESLint, Vitest, security policy, Knip and local Supabase integration.
- Player Pages and Social Cards run `141` passed, including responsive browser journeys and frontend coverage checks.
- Public Asset Audit run `82` passed.
- Pull Request Visual Evidence remains blocked because the required generated PNG files must be uploaded as GitHub PR attachments; the available connector cannot upload local binary attachments and generated screenshots are intentionally not committed to Git.

## Rollback

Revert the home enhancement, final stylesheet, regression tests and this specification. No persistent data or migration rollback is required.

## Delivery

- Branch: `agent/fix-mobile-awards-ranking`
- Base: `main`
- Pull request: `#21`
- Normal pull request; no merge or deployment without explicit authorization.

## Status

Implementation and automated validation complete. Pull request open and blocked only by the required manual Desktop/Mobile screenshot attachments.
