# Social previews and responsive actions

## Request

Extend pull request #26 so every user-facing shared URL has a crawler-rendered Open Graph and X/Twitter preview. Direct challenges must show the verified time to beat in both the shared card and the game UI. Shared results must show the exact persisted attempt. Fix account/player action buttons so they never overflow and validate all affected layouts on desktop and mobile.

## Evidence

- Direct challenges shared `/?duel=<uuid>`, which inherited the generic home preview.
- Result sharing could fall back to a profile/referral URL because the sharing module loaded after the completion event.
- `game_duels` stored only the target difference, not the exact verified attempt time used to create the challenge.
- `game_attempts` contains immutable attempt ID, nick, team, elapsed time, difference, verification state and competition scope.
- Account player actions used an inline flex row that exceeded the card width on narrow viewports.
- Local Edge execution exposed an internal runtime hostname in generated Open Graph URLs until the public origin was resolved explicitly.

## Decisions

- Add service-role-only public projection RPCs for duel, attempt and referral cards; never trust URL/query values for time or player identity.
- Persist the exact verified challenger attempt and elapsed time when creating a duel.
- Add versioned `social-share` HTML/PNG routes for profile, league, duel, result and referral links.
- Redirect human visitors from social routes to canonical playable URLs.
- Display challenger, verified target time and target difference before the recipient starts playing.
- Retain the latest completed attempt independently of script load order and share that persisted attempt ID.
- Resolve public Edge URLs from an explicit public origin, trusted forwarded host, or the public Supabase URL; reject internal runtime hosts.
- Use CSS Grid with `minmax(0, 1fr)`, `min-width: 0` and one-column mobile actions.
- Keep database changes additive and preserve all existing duel/result history.

## Acceptance

- [x] Direct challenge share HTML contains complete Open Graph and X/Twitter image metadata.
- [x] Direct challenge PNG is 1200×630 and includes challenger, target time, target difference and expiry/state.
- [x] Opening a duel displays the verified time to beat before playing.
- [x] Shared result HTML/PNG uses the persisted attempt ID and exact time/difference.
- [x] Profile, referral, league, duel and result actions resolve to crawler-rendered share routes.
- [x] Generated metadata never contains internal Supabase runtime hostnames.
- [x] Account player action controls remain inside their card at desktop and mobile widths without horizontal overflow.
- [x] Unit/static tests, local Supabase integration, PNG validation and Playwright desktop/mobile journeys pass.

## Validation

- Pull Request Quality Pipeline #479 passed, including clean install, syntax, asset audit, Vitest, ESLint, Knip, security policy and local Supabase rebuild/integration.
- Player Pages and Social Cards #211 passed focused 100% module coverage and desktop/mobile Playwright journeys.
- Public Asset Audit #152 passed.
- Pull Request Visual Evidence #176 passed with immutable desktop/mobile account screenshots.
- Integration generated and verified 1200×630 PNG signatures, dimensions, cache headers and corresponding Open Graph/X metadata for every available social route.
- Empty-database rebuild validation no longer relies on fixtures correctly removed by reset; the full journey still validates all route families before the rebuild.

## Delivery

- Branch: `agent/feat-profile-cards-league-trophies`
- Pull request: #26
- Rollback: revert application commits; supersede applied additive migrations with a forward migration if required.
- No merge, deployment or production migration performed.

## Status

Completed in pull request #26. Implementation, responsive evidence and CI validation are complete.
