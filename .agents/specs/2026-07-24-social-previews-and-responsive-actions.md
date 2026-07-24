# Social previews and responsive actions

## Request

Extend pull request #26 so every user-facing shared URL has a crawler-rendered Open Graph and X/Twitter preview. Direct challenges must show the verified time to beat in both the shared card and the game UI. Shared results must show the exact persisted attempt. Fix account/player action buttons so they never overflow and validate all affected layouts on desktop and mobile.

## Evidence

- Direct challenges currently share `/?duel=<uuid>`, which inherits the generic home preview.
- Result sharing currently resolves to a static page/referral URL instead of a persisted-attempt preview.
- `game_duels` already stores the challenger target difference and expiry.
- `game_attempts` stores immutable attempt ID, nick, team, elapsed time, difference, verification state and competition scope.
- Account player actions use an inline flex row that can exceed the card width on narrow viewports.

## Decisions

- Add service-role-only public projection RPCs for duel and attempt cards; never trust share-query values for times or player identity.
- Add versioned `social-share/duel/<code>` and `social-share/result/<attempt-id>` HTML/PNG routes.
- Redirect human visitors from social routes to the canonical playable URL.
- Use the duel target as `10.600 s ± challenger difference` and expose both target time and allowed difference in the UI.
- Route result, referral, profile, league and duel share actions through crawler-rendered URLs.
- Use CSS Grid with `minmax(0, 1fr)` and full-width compact actions at narrow widths.
- Keep database changes additive and preserve all existing duel/result history.

## Acceptance

- Direct challenge share HTML contains complete Open Graph and X/Twitter image metadata.
- Direct challenge PNG is 1200×630 and includes challenger, target time, target difference and expiry/state.
- Opening a duel displays the verified time to beat before playing.
- Shared result HTML/PNG uses the persisted attempt ID and exact time/difference.
- Every visible share action resolves to a `social-share` route or the static root preview.
- Account player action controls remain inside their card at desktop, tablet and mobile widths.
- Unit/static tests, local Supabase integration, PNG validation and Playwright desktop/mobile journeys pass.

## Validation

- `pnpm check`
- `pnpm test:supabase`
- `pnpm test:e2e`
- GitHub Actions quality, browser/social-card, asset and visual-evidence workflows

## Delivery

- Branch: `agent/feat-profile-cards-league-trophies`
- Pull request: #26
- Rollback: revert application commits; supersede applied additive migrations with a forward migration if required.

## Status

In progress.
