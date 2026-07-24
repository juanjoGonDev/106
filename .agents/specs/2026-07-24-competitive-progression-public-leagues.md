# Competitive progression and public leagues

## Request

Expand the achievement system with durable progression for perfect attempts, averages, direct challenges, league participation, league podiums and other engagement milestones. Improve global ranking ties, provide a dedicated public league route, separate public league identifiers from private join credentials, let players choose global or any joined league before an attempt, prevent exhausted or unavailable players from starting, validate nickname ownership while typing and remove duplicated profile loading from the home page.

## Evidence

- `game_player_achievements` only accepts trophy-derived achievement kinds and `refresh_game_player_achievements()` only evaluates daily trophies.
- Global precision currently orders equal differences by attempt creation time and does not expose tie-break evidence on the dedicated ranking page.
- League `code` is simultaneously used as public lookup identifier, public share URL, join credential and gameplay scope. A public league URL therefore discloses the credential required to join.
- The league page only supports `ligas.html?league=<code>` and GitHub Pages clean-route fallback only redirects player routes.
- The home game can only enter league scope through a query string. It has no selector for a player belonging to multiple leagues.
- `app.js` and `honours.js` independently request the current profile. League context can add another player-scoped request.
- `validateSetup()` does not account for ownership, selected competition availability or exhausted attempts.
- The nickname debounce loads a profile but does not tell a new account that an existing nickname belongs to another account.
- The home ranking header still displays total attempts and explanatory copy requested for removal.
- Dedicated ranking and league documents do not contain complete static Open Graph and X/Twitter metadata.

## Decision

1. Add an immutable public league identifier and keep the join code as a private credential.
2. Preserve existing public links by copying the old code into `public_id`, then rotate existing join codes during migration so already exposed codes cannot continue granting membership.
3. Use public identifiers for reads, clean URLs, profiles, social metadata and share cards. Use private join codes only for joining and an internal competition code only for authenticated gameplay.
4. Add a single `player-context` API action returning nickname availability, the profile and joined leagues. The browser must use this as the only player-scoped home request.
5. Attach an existing account token to `player-context` without creating an account merely because somebody typed a nickname.
6. Make the competition selector authoritative. Global is the default; an active joined league can be selected; the last valid choice is cached locally.
7. Disable attempt preparation when the nickname is occupied, the selected competition is unavailable, or no attempts remain.
8. Extend achievements additively with cumulative perfect attempts, perfect average, verified-attempt milestones, precision bands, referrals, challenges created, challenge victories, league participation and per-league podium achievements.
9. Award league podium points deterministically after an eligible league finishes. Keep one champion trophy while awarding first, second and third place achievements.
10. Rank global players by best verified difference, then achievement points, daily trophies, league wins with lower precedence, verified attempts, average difference, earliest best result and normalized nickname.
11. Keep the compact home ranking unchanged visually. Show tie-break evidence and an exact ordering explanation only on the dedicated ranking page.
12. Publish `/ligas/<public-id>` through the Pages fallback and use that clean website URL for league navigation and sharing.
13. Remove the attempt counter and help paragraph from the home Top 10 card.
14. Add static Open Graph and X/Twitter metadata to every dedicated HTML document touched by this change and keep league-specific metadata/versioned PNGs in the dynamic social renderer.
15. Implement all schema changes as a forward-only additive migration and retain restricted `SECURITY DEFINER` execution.

## Achievement catalogue

- **Primer latido perfecto** — first verified attempt exactly at 10.600.
- **Reloj dominado** — 3, 5, 10, 25, 50 and 100 perfect attempts.
- **Media imposible** — an exact zero-millisecond average after at least three verified attempts.
- **Rodaje competitivo** — verified-attempt thresholds from 5 to 500.
- **Zona de precisión** — first marks within 1 s, 250 ms, 100 ms, 50 ms and 10 ms.
- **Guante lanzado** — first direct challenge created and creation thresholds.
- **Duelo ganado** — first direct challenge victory plus 5, 10, 50 and 100 victories.
- **Convocatoria completa** — completed referral thresholds rewarding successful sharing.
- **Jugador de liga** — completed-league participation thresholds.
- **Podio de liga** — persistent first, second or third place achievement for every eligible completed league.
- Existing trophy, streak, collection and monthly achievements remain durable, with clearer public titles and descriptions.

## Ranking order

Global precision uses one best verified global attempt per nickname:

1. lowest absolute difference from 10.600;
2. most achievement points;
3. most daily trophies;
4. most league championships;
5. most verified global attempts;
6. lowest verified global average difference;
7. earliest timestamp of the best mark;
8. normalized nickname.

The last criteria only guarantee deterministic order. League standings remain scoped to their own verified marks and use the same progression evidence where practical.

## Scope

- New Supabase migration for public league identities, achievement progression, podium processing, profile contracts and global ranking.
- `game-api` player context and public league API contracts.
- Dynamic social-share league routes and cards.
- Home game player-context coordination and competition selector.
- League management/public route, public profile league links and dedicated ranking details.
- Static metadata and clean-route fallback.
- Unit/contract tests, local Supabase integration tests, browser acceptance tests and visual evidence.
- Product and security documentation.

## Acceptance

- An anonymous visitor can view `/106/ligas/<public-id>` without a nickname, account token or join credential.
- A public league response, URL, metadata document, card and player trophy entry never expose the private join code.
- Joining still requires the private code and existing leaked codes are invalid after migration.
- Creation returns both values only to the authenticated creator flow; member context keeps the competition code internal and never renders it.
- The home performs one `player-context` request after the final debounced nickname input and no independent profile request from honours.
- Typing resumes the debounce timer and stale responses cannot overwrite the latest nickname state.
- Occupied nicknames are reported before attempt preparation and the start control remains disabled.
- Global and each joined league appear in one selector; global is selected initially and the last still-valid selection is restored.
- Exhausted scopes show an explicit warning and cannot start through button, retry or direct function flow.
- Perfect attempts accumulate across verified attempts and every new achievement is idempotent.
- Eligible completed leagues persist deterministic podium achievements and the champion trophy/profile entry contains league name, public route and date.
- Exact global time ties use the documented progression criteria. Home remains compact; dedicated ranking exposes the decisive fields.
- The home Top 10 card contains neither total attempt count nor instructional paragraph.
- Ranking, league and fallback documents include Open Graph and X/Twitter image metadata.
- Syntax, lint, dead-code, unit, security, browser, Supabase rebuild/incremental migration and integration checks pass.

## Risks

- Rotating existing join codes intentionally invalidates credentials previously exposed in public URLs. This is required to restore confidentiality; owners receive a new private invitation code through their authenticated league list.
- Achievement backfill can insert many append-only rows. The migration uses unique achievement codes, deterministic queries and one-time refreshes to remain idempotent.
- More ranking joins increase `get_game_stats()` work. Aggregation is done once per player with indexed source tables and the public result remains bounded.
- A browser with no imported account can distinguish an available nickname from an occupied nickname, but receives no private profile or league credentials.
- Static GitHub Pages metadata is generic; league-specific crawler metadata remains generated by the versioned social endpoint while the shared human URL stays on the public website.

## Tests

- Contract tests assert the private/public league boundary, clean route, metadata, achievement families, ranking order and single player-context ownership.
- Supabase integration creates independent accounts and leagues, proves public lookup cannot join, verifies selector context, exercises perfect/duel/league progression and validates deterministic ties.
- Playwright covers debounced nickname checks, occupied/exhausted states, selector persistence, clean public league viewing and dedicated ranking tie-break presentation on desktop and mobile.
- Existing trophy, profile, sharing, security, home synchronization and deployment snapshot suites remain applicable and are updated for the new contracts.

## Rollback

Revert application commits only if necessary. Do not remove persisted achievements, public identifiers or rotated credentials. Any schema correction must be a new forward migration after reviewing backups and production snapshots.

## Delivery

- Branch: `agent/feat-competitive-progression`
- Base: `main`
- Pull request: pending implementation and validation.
- No merge, deployment or production migration without explicit authorization.

## Status

Implementation in progress.
