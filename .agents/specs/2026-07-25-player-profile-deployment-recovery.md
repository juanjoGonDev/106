# Player profile deployment recovery

## Request

Restore public player profiles after the production Supabase deployment failed. The profile page must remain readable when the newer `player-context` Edge Function is temporarily unavailable, and deployment validation must reproduce the legacy database relation that blocked the honours migration.

## Evidence

- Production player pages stopped at `Failed to fetch` because `public/player.js` had a single hard dependency on the `player-context` Edge Function.
- The failed deployment attempted the honours rollout while PostgreSQL already contained `public.player_achievement_highlights`, a legacy relation from an earlier partial or manual rollout.
- The canonical implementation stores selections in `public.game_player_featured_achievements`, so the production relation required explicit forward adoption instead of destructive replacement.
- Previous CI rebuilt an empty local database and therefore validated fresh installation but not an upgrade from the observed legacy production state.
- `game-api` already exposes the public `public-profile` action, allowing the dedicated player page to degrade to a safe read-only profile rather than becoming unavailable.

## Decision

1. Add a forward-only compatibility migration ordered before the honours migration.
2. Create the canonical featured-achievement table idempotently, detect the legacy relation at runtime and copy at most three valid unlocked selections per player.
3. Preserve canonical active selections when they already exist, normalize legacy slot ordering and retain the legacy relation without dropping production data.
4. Revoke public client access from the legacy relation.
5. Load `player-context` first on the public profile page. When that endpoint is unavailable, retry the public read through the existing `game-api` `public-profile` action.
6. Treat fallback profiles as read-only: never expose the featured-achievement editor without verified ownership context.
7. Show a compact recovery notice and provide explicit retry actions instead of displaying a raw browser network error as the only outcome.
8. Add a local Supabase upgrade test with isolated fixture players that creates the observed legacy relation, replays the compatibility migration twice and verifies copying, precedence, ordering, permissions, cleanup and idempotency.
9. Add responsive browser coverage that aborts `player-context`, requires the `game-api` fallback and verifies recovery to the ownership-aware context on desktop and mobile.

## Acceptance

- [x] A player profile renders when `player-context` cannot be reached but `game-api` remains available.
- [x] The degraded profile is explicitly read-only and does not show owner-only controls.
- [x] A transient failure can be retried without navigating away.
- [x] A database containing `public.player_achievement_highlights` can apply all current migrations without a duplicate-relation error.
- [x] Valid legacy selections are copied to `public.game_player_featured_achievements` in deterministic positions one through three.
- [x] Existing canonical active selections take precedence over legacy rows.
- [x] Reapplying the compatibility migration is idempotent.
- [x] Anonymous and authenticated roles cannot read or mutate the legacy relation.
- [x] Syntax, lint, dead-code, unit, security, migration safety, local Supabase integration and desktop/mobile Playwright checks pass.

## Risks

- Legacy rows can contain stale or invalid achievement codes. Mitigation: copy only rows backed by an existing player and an unlocked achievement.
- Legacy positions can be duplicated or malformed. Mitigation: rank valid rows deterministically by stored position and achievement code, then retain only the first three.
- Fallback loading could accidentally grant edit capabilities. Mitigation: fallback context always reports `availability: unknown` and the editor remains hidden.
- A fallback could conceal a permanent backend deployment fault. Mitigation: display a visible read-only recovery notice and keep production deployment checks authoritative.

## Tests

- Vitest contract assertions cover migration ordering, legacy detection, non-destructive copying, fallback routing and read-only state.
- The local PostgreSQL upgrade regression creates two isolated players: one verifies deterministic legacy copying, while the other proves an active canonical selection takes precedence. It reapplies the migration, verifies RLS and privileges, and removes all fixtures without changing real journey profiles or revisions.
- The responsive Playwright journey aborts `player-context`, requires the `public-profile` fallback, verifies owner controls remain hidden, then retries and confirms full ownership context recovery.
- Existing full Supabase, profile, sharing, security, asset, lint and dead-code suites remain active.

## Rollback

Revert the frontend fallback and compatibility migration commit if necessary. Do not remove copied canonical selections or drop the legacy relation. Any later cleanup must be a separately reviewed forward migration after production data inspection and backup verification.

## Validation

Implementation head `33f0e3bec0d9551cc8eba67bda460d14c5666ee5`:

- Pull Request Quality Pipeline `30138216847`: frozen installation, build, syntax, Vitest, ESLint, Knip, dependency and source security policy, clean migration rebuild, isolated legacy upgrade regression, complete Supabase API and social-card integration, and Quality Gate passed.
- Player Pages and Social Cards `30138216855`: desktop/mobile recovery journey, existing profile journeys and strict frontend module coverage passed.
- Pull Request Visual Evidence `30138216843`: passed.
- Public Asset Audit `30138216839`: passed.

## Delivery

- Branch: `agent/fix-player-profile-deployment`.
- Base: `main`.
- Pull request: `#31`.
- Implementation validation head: `33f0e3bec0d9551cc8eba67bda460d14c5666ee5`.
- No merge, production migration, function deployment or release performed.

## Status

Completed and validated. Pending review, merge and production deployment authorization.
