# Player profile deployment recovery

## Request

Restore public player profiles after the production Supabase deployment failed. The profile page must remain readable when the newer `player-context` Edge Function is temporarily unavailable, and deployment validation must reproduce the legacy database relation that blocked the honours migration.

## Evidence

- Production player pages currently stop at `Failed to fetch` because `public/player.js` has a single hard dependency on the `player-context` Edge Function.
- The failed deployment attempted migration `20260724213400_honours_progress_featured_achievements.sql` and PostgreSQL rejected `CREATE TABLE public.player_achievement_highlights` because that legacy relation already existed.
- The canonical implementation now stores selections in `public.game_player_featured_achievements`, while production can still contain `public.player_achievement_highlights` from an earlier partial or manual rollout.
- Existing CI rebuilds an empty local database. It validates fresh installation but does not exercise an upgrade from the observed legacy production state.
- `game-api` already exposes the public `public-profile` action, so the dedicated player page can degrade to a safe read-only profile instead of becoming unavailable.

## Decision

1. Add a forward-only compatibility migration ordered before the honours migration.
2. Create the canonical featured-achievement table idempotently, detect the legacy relation at runtime and copy at most three valid unlocked selections per player.
3. Preserve canonical active selections when they already exist, normalize legacy slot ordering and retain the legacy relation without dropping production data.
4. Revoke public client access from the legacy relation.
5. Load `player-context` first on the public profile page. When that endpoint is unreachable or returns a server/deployment failure, retry the public read through the existing `game-api` `public-profile` action.
6. Treat fallback profiles as read-only: never expose the featured-achievement editor without verified ownership context.
7. Show a compact recovery notice and provide an explicit retry action instead of displaying a raw browser error as the only outcome.
8. Add a local Supabase upgrade test that creates the observed legacy relation, replays the compatibility migration twice and verifies data preservation, ordering, permissions and idempotency.
9. Add responsive browser coverage that aborts `player-context`, requires the `game-api` fallback and verifies the profile remains usable on desktop and mobile.

## Acceptance

- [ ] A player profile renders when `player-context` cannot be reached but `game-api` remains available.
- [ ] The degraded profile is explicitly read-only and does not show owner-only controls.
- [ ] A transient failure can be retried without navigating away.
- [ ] A database containing `public.player_achievement_highlights` can apply all current migrations without a duplicate-relation error.
- [ ] Valid legacy selections are copied to `public.game_player_featured_achievements` in deterministic positions one through three.
- [ ] Existing canonical active selections take precedence over legacy rows.
- [ ] Reapplying the compatibility migration is idempotent.
- [ ] Anonymous and authenticated roles cannot read or mutate the legacy relation.
- [ ] Syntax, lint, dead-code, unit, security, migration safety, local Supabase integration and desktop/mobile Playwright checks pass.

## Risks

- Legacy rows can contain stale or invalid achievement codes. Mitigation: copy only rows backed by an existing player and an unlocked achievement.
- Legacy positions can be duplicated or malformed. Mitigation: rank valid rows deterministically by stored position and achievement code, then retain only the first three.
- Fallback loading could accidentally grant edit capabilities. Mitigation: fallback context always reports `availability: unknown` and the editor remains hidden.
- A fallback could conceal a permanent backend deployment fault. Mitigation: display a visible read-only recovery notice and keep production deployment checks authoritative.

## Tests

- Vitest contract assertions for migration ordering, legacy detection, non-destructive copying, fallback routing and read-only state.
- Local PostgreSQL upgrade regression that creates the exact legacy table shape, inserts a valid selection, executes the compatibility migration twice and checks the canonical row and privileges.
- Playwright desktop/mobile journey with an aborted `player-context` request and a successful `public-profile` fallback.
- Existing full Supabase, profile, sharing, security, asset, lint and dead-code suites remain active.

## Rollback

Revert the frontend fallback and compatibility migration commit if necessary. Do not remove copied canonical selections or drop the legacy relation. Any later cleanup must be a separately reviewed forward migration after production data inspection and backup verification.

## Delivery

- Branch: `agent/fix-player-profile-deployment`.
- Base: `main`.
- Pull request: pending.
- No merge, production migration, function deployment or release without explicit authorization.

## Status

Implementation in progress.
