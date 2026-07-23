# Mobile awards and compact ranking layout

## Request

Keep the daily awards visible on phones directly below the Spain-versus-Argentina score while preserving the desktop right rail. Rework the desktop home ranking so every entry uses two rows: rank, flag and nick on the first row; time and difference on the second row. Remove the nested visual container and the horizontal hover movement.

Follow-up: reduce the excessive vertical space between ranking players so it matches the compact spacing used by the daily-awards cards.

## Evidence

- `public/layout.js` moves `#awardsCard` into the right rail for every viewport.
- `public/v4.css` hides `.awards-card` at widths up to 500px, so phone users cannot see the daily awards.
- `public/ranking-enhancements.js` already refreshes the same awards DOM nodes after `minuto106:attempt-finished`, so moving the existing card preserves live updates without duplicating state.
- `public/v11.css` and the previous `public/v12.css` apply visual surfaces to both the list item and its link, creating a nested card effect.
- Both the list item and link apply `translateX` on hover, which shifts ranking content horizontally.
- The previous compact ranking puts nick, flag, time and difference on one row, which does not fit the narrow desktop rail reliably.
- `public/v5.css` applies `padding: 9px !important` through `.layout-rail .leaderboard li`. The initial `.leaderboard-row` reset in `public/v12.css` had lower specificity, so the inherited wrapper padding remained active.
- That unresolved wrapper padding added 18px around every pair of adjacent cards, on top of the list gap, producing the large spaces visible in the desktop rail.
- The daily-awards rail uses an 8px grid gap and provides the accepted compact spacing reference.

## Decision

- Extend `public/home-ranking-density.js`, which already runs after the three-column layout is built, to move the existing awards card after `.battle-card` at widths up to 700px and restore it as the first item in the right rail above that breakpoint.
- Keep one awards card and one set of award IDs; do not clone markup or introduce a second refresh path.
- Render ranking identity as flag plus nick on row one, with time and difference on row two.
- Keep the country available as the flag image alternative text and remove visible country copy from the compact ranking.
- Make the anchor the only visual row surface. Reset the list item background, border, outline, transform and transition.
- Remove every horizontal hover transform while retaining a background response and visible keyboard focus.
- Override the legacy rail list-item padding with a selector of sufficient specificity, reset wrapper margin and gap, and set the leaderboard list gap to the same 8px used by daily awards.

## Acceptance

- At viewport widths up to 700px, daily awards appear immediately below the global score card.
- Above 700px, daily awards remain in the right rail before the competition card.
- Awards continue to refresh after each successful attempt through the existing attempt-finished event.
- Each ranking row displays rank, flag and nick on the first line, with time and difference on the second line.
- Country names are not visibly repeated; each flag has a meaningful `alt` value.
- Each ranking entry has one visual container and does not move horizontally on hover or focus.
- Keyboard focus remains visible and the entire row remains the profile link.
- Desktop ranking wrappers have zero block padding and zero block margin.
- The visible gap between adjacent ranking cards is 8px, matching the daily-awards grid.

## Scope

- Home-page responsive awards placement.
- Home-page compact ranking markup and styles.
- Regression tests for the responsive and presentation contracts.
- No API, database, scoring, account, league or deployment changes.

## Risks

- The responsive placement depends on the existing `.battle-card` and `.layout-rail--right` selectors; tests pin that contract.
- Moving a live DOM node across columns must not clone or replace it, otherwise award refresh listeners and IDs could diverge.
- CSS rules from earlier versioned stylesheets remain in the cascade; the final stylesheet must explicitly neutralize their transforms, nested surfaces and high-specificity list-item padding.

## Validation

- Updated the existing unit contract for the two-row ranking, responsive awards placement, accessible flags and retained attempt-finished refresh path.
- Updated the source contract to require the 8px leaderboard gap and the high-specificity zero-margin/zero-padding wrapper reset.
- Updated the Playwright journey to compare the leaderboard grid gap with the daily-awards grid, verify zero wrapper padding and margin, and measure the rendered 8px distance between adjacent profile links.
- Previous implementation validation passed in Pull Request Quality Pipeline run `410`, Player Pages and Social Cards run `142`, and Public Asset Audit run `83`.
- Validation for the spacing follow-up is pending on the new pull-request head.
- Pull Request Visual Evidence remains blocked because the required generated PNG files must be uploaded as GitHub PR attachments; the available connector cannot upload local binary attachments and generated screenshots are intentionally not committed to Git.

## Rollback

Revert the home enhancement, final stylesheet, regression tests and this specification. No persistent data or migration rollback is required.

## Delivery

- Branch: `agent/fix-mobile-awards-ranking`
- Base: `main`
- Pull request: `#21`
- Normal pull request; no merge or deployment without explicit authorization.

## Status

Spacing follow-up implemented and committed. Automated validation is running; pull request remains open.
