# Versioned player cards and eligible league trophies

## Request

- Regenerate the public player image after every profile-changing update, including achievements, daily rewards and new global attempts.
- Use the current player image as Open Graph and X/Twitter metadata on the public profile/share surface.
- Add league trophies without allowing self-created or same-device leagues to produce farmable honours.
- A new league must not start until at least three participants belong to three different accounts and use three different devices.

## Evidence

- `player-share` renders the PNG from current profile data, but the image and share HTML used stable URLs with intermediary cache lifetimes. A social platform could therefore reuse a card created before a new attempt, achievement or daily trophy.
- Static GitHub Pages cannot server-render nickname-specific Open Graph metadata before JavaScript executes.
- `game_leagues` previously started its three-day clock at creation and allowed the owner to compete immediately.
- League membership was keyed only by nick, so one account or one device could represent several apparent participants.
- No eligible completed-league winner was persisted in the public profile.

## Decision

1. Add a monotonic `profileRevision` derived from global attempts, bonus/referral updates, daily trophies, achievements and league trophies.
2. Append that revision to crawler-facing share URLs and PNG URLs so each profile change receives a new cache key.
3. Use the Edge `social-share` endpoint as the server-rendered Open Graph/Twitter surface and mirror current metadata in the browser player document.
4. Keep new leagues waiting until membership contains three pairwise-distinct account IDs and three pairwise-distinct stable device hashes.
5. Use each player's first recorded device hash as the stable device identity.
6. Activate a league exactly once and then set a new three-day competition window.
7. Reject league challenge creation before activation.
8. Preserve already-created leagues as active during migration.
9. Persist one deterministic `league_champion` trophy per eligible completed league: smallest difference, earliest attempt, nick key, then attempt ID.
10. Keep trophy synchronization idempotent and advisory-lock protected.

## Scope

- Additive PostgreSQL migrations and service-role RPCs.
- `game-api` action routing and league error messages.
- Versioned player, league, duel, result and referral share metadata/cards.
- Player profile metadata and league-trophy rendering.
- League waiting/activation UI.
- Unit, security, database integration and browser coverage.

## Risks

- Social platforms retain caches outside application control; versioned URLs provide deterministic invalidation for changed persisted data.
- Existing leagues are grandfathered as active to avoid invalidating competitions in progress.
- Account and device hashes remain server-only, RLS-protected and absent from public RPC responses.
- A completed league without a verified attempt produces no champion trophy.

## Acceptance

- [x] A global attempt changes `profileRevision`.
- [x] A daily trophy or achievement changes `profileRevision`.
- [x] A league champion trophy changes `profileRevision`.
- [x] Player share HTML emits `og:image`, `og:image:secure_url`, `twitter:image` and `twitter:image:src` using the revisioned PNG URL.
- [x] Browser player metadata mirrors the revisioned image and share URL.
- [x] New leagues report a waiting state and cannot create a challenge with one or two eligible participants.
- [x] Multiple nicks from one account do not increase the eligible-owner count.
- [x] Multiple accounts represented by the same stable device do not activate a league.
- [x] The third distinct account on the third distinct device activates the league exactly once and starts its three-day clock.
- [x] Existing leagues remain active after migration.
- [x] An eligible completed league awards exactly one deterministic `league_champion` trophy.
- [x] Repeated synchronization does not duplicate league trophies.
- [x] League trophies appear in the public profile and generated overview/trophy cards.
- [x] Global and league attempt isolation remains unchanged.

## Validation

- Pull Request Quality Pipeline #479: build, syntax, package policy, Vitest, ESLint, Knip, dependency/security checks, empty rebuild and full local Supabase/API journey passed.
- Player Pages and Social Cards #211: focused 100% coverage gates plus desktop/mobile Playwright journeys passed.
- Public Asset Audit #152 passed.
- Pull Request Visual Evidence #176 passed.
- Local integration generated and validated 1200×630 profile, league, duel, result and referral PNGs and their Open Graph/X metadata.
- PostgreSQL integration asserted trigger-function privileges, league identity rules, waiting-state rejection, activation and global/league isolation.

## Rollback

- Revert application and Edge changes normally.
- Database changes are forward-only. If already deployed, retain additive structures and supersede behavior with a corrective migration.

## Delivery

- Branch: `agent/feat-profile-cards-league-trophies`
- Base: `main`
- Pull request: #26
- No merge, production migration or deployment performed.

## Status

Completed in pull request #26. Implementation and CI validation are complete; merge and deployment remain explicit owner actions.
