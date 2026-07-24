# Versioned player cards and eligible league trophies

## Request

- Regenerate the public player image after every profile-changing update, including achievements, daily rewards and new global attempts.
- Use the current player image as Open Graph and X/Twitter metadata on the public profile/share surface.
- Add league trophies without allowing self-created or same-device leagues to produce farmable honours.
- A new league must not start until at least three participants belong to three different accounts and use three different devices.

## Evidence

- `player-share` renders the PNG from current profile data, but the image and share HTML use stable URLs with intermediary cache lifetimes. A social platform can therefore reuse a card created before a new attempt, achievement or daily trophy.
- The static GitHub Pages player shell cannot server-render nickname-specific Open Graph metadata. The existing `player-share/<nick>` HTML endpoint is the crawler-facing profile surface and redirects human visitors to the clean Pages route.
- `game_leagues` currently starts its three-day clock at creation and the owner can compete immediately.
- League membership is keyed only by nick. One account can own multiple nicks, and multiple accounts can be used from one device, so a three-nick threshold alone would be farmable.
- Daily trophies are persisted separately from leagues. No eligible completed-league winner is currently persisted in the public profile.

## Decision

1. Add a monotonic `profileRevision` derived from all persisted data that changes a public profile: global attempts, bonus/referral updates, daily trophies, achievements and league trophies.
2. Append that revision to both crawler-facing share URLs and PNG URLs. Each profile update therefore produces a new cache key while retaining bounded caching for unchanged revisions.
3. Keep the Edge `player-share` HTML endpoint as the authoritative server-rendered Open Graph/Twitter profile surface. Also mirror the current tags into the browser player document for inspection and client integrations.
4. Add waiting league activation. New leagues keep their competition clock stopped until membership contains at least three distinct account IDs and three distinct device hashes.
5. Capture account and device identity on league membership. The API passes the validated request device hash to joins; account identity is resolved from the already-authorized nick.
6. Activate exactly once when both thresholds are reached, then set `starts_at = now()` and `ends_at = now() + 3 days`.
7. Route new league starts through a guarded RPC that rejects waiting leagues before delegating to the existing pointer-only challenge RPC.
8. Preserve already-created leagues as active during migration to avoid retroactively invalidating live competitions.
9. Persist one `league_champion` trophy for the verified winner of each eligible completed league. Selection is deterministic: smallest difference, then earliest attempt, then nick key.
10. Synchronize completed league trophies idempotently from public profile reads, expose their count/history, include them in the profile card, and include their timestamp in `profileRevision`.

## Scope

- Additive PostgreSQL migration and private RPCs.
- `game-api` action routing and league error messages.
- Player-share metadata/card cache versioning.
- Player page metadata and league-trophy rendering.
- League waiting/activation UI.
- Unit/static contracts and local Supabase integration coverage.
- README documentation.

## Risks

- Social platforms retain caches outside application control. Versioned share and image URLs provide the strongest deterministic invalidation available without owning a reverse proxy for the GitHub Pages path.
- Existing leagues are grandfathered as active; only leagues created after this migration require three eligible participants.
- Account and device hashes are sensitive identifiers. They remain server-only, RLS-protected and are never returned by public RPCs.
- Lazy trophy synchronization must be idempotent and advisory-lock protected to avoid duplicate winners under concurrent profile reads.
- A league with no verified attempt produces no champion trophy.

## Acceptance

- [ ] A global attempt changes `profileRevision`.
- [ ] A daily trophy or achievement changes `profileRevision`.
- [ ] A league champion trophy changes `profileRevision`.
- [ ] Player share HTML emits `og:image`, `og:image:secure_url`, `twitter:image` and `twitter:image:src` using the same revisioned PNG URL.
- [ ] Browser player metadata mirrors the revisioned image and share URL.
- [ ] New leagues report a waiting state and cannot create a challenge with one or two eligible participants.
- [ ] Multiple nicks from one account do not increase the eligible-owner count.
- [ ] Multiple accounts from one device do not increase the eligible-device count.
- [ ] The third distinct account on the third distinct device activates the league exactly once and starts its three-day clock.
- [ ] Existing leagues remain active after migration.
- [ ] An eligible completed league awards exactly one deterministic `league_champion` trophy.
- [ ] Repeated synchronization does not duplicate league trophies.
- [ ] League trophies appear in the public profile and generated overview/trophy cards.
- [ ] Global and league attempt isolation remains unchanged.

## Validation

- Pending implementation.

## Rollback

- Revert application and Edge changes normally.
- Database changes are forward-only. If already deployed, leave additive columns/table/functions in place and supersede behavior with a corrective migration.

## Delivery

- Branch: `agent/feat-profile-cards-league-trophies`
- Base: `main`
- Normal pull request; no merge, production migration or deployment without explicit authorization.

## Status

In progress.
