# League directory, dedicated pages and scheduled competitions

## Request

- Make every clean `/ligas/<public-id>` route a dedicated league page containing only that league, its classification and league-specific actions.
- Show **Jugar** only to a member while the league is active and attempts remain; opening it must select that league on the home game.
- Add a searchable league directory with public/private filtering and a lock indicator for private leagues.
- Allow direct entry into public leagues while private leagues continue to require an invitation code.
- Let creators choose visibility, a maximum of 10–100 participants in increments of 10 (default 10), and a duration of 1–7 days (default 3).
- When the existing minimum of three distinct accounts and three distinct devices is reached, schedule the start 23 hours later instead of starting immediately.
- Provide strict automated coverage and complete desktop/mobile visual recordings so the change can be reviewed remotely.

## Evidence

- `public/ligas.html` currently combines account controls, creation, invitation entry, memberships and league details on the same clean route.
- `public/ligas.js` treats league navigation as an in-page switch, so `/ligas/<id>` still renders the complete management hub.
- The current database schema has no visibility, duration or capacity settings.
- `activate_game_league_if_eligible` currently sets `starts_at` immediately and always uses a three-day duration.
- The existing eligibility calculation already requires three pairwise-distinct accounts and devices.
- Existing joins do not cap membership or reject another nickname representing an account/device already present in the same league.
- The home competition selector already consumes `?competition=<public-id>` and the prepared-attempt API already persists that public league scope.
- The repository browser workflow already uploads `.tmp/pr-previews/`, making remote PNG, WebM and derived GIF review possible.

## Decision

1. Introduce additive league configuration migrations with `visibility`, `duration_days` and `max_participants` constraints.
2. Keep existing leagues private with the previous defaults (`3` days and `10` places); do not rewrite historical rows or credentials.
3. Treat the eligibility threshold as a scheduling transition: `activated_at` records the threshold time, `starts_at` is exactly 23 hours later, and `ends_at` derives from the selected duration.
4. Model league phases explicitly as waiting, scheduled, active and finished. Attempt preparation requires the active phase, including `starts_at <= now`.
5. Serialize joining on the league row. A nickname already in the league is idempotent; a different nickname with the same account or stable device identity is rejected. This restriction is **per league**, not a global limit of one league per account/device, because users must still be able to participate in multiple competitions.
6. Enforce capacity inside the same locked transaction to avoid concurrent overbooking.
7. List public and private metadata through a secret-free projection. Public IDs permit joining only when visibility is public; private membership still requires `join_code`.
8. Isolate league operations in a focused `league-api` Edge Function instead of extending the already broad game endpoint. Existing account tokens and stable device headers remain the authorization boundary.
9. Split pure browser decisions into `league-directory.js` and enforce 100% line/function/branch coverage with Node's native V8 coverage.
10. Render directory management only on `/ligas.html`; clean league routes hide all hub sections before rendering and expose only league controls.
11. Generate three complete responsive evidence areas—directory, active detail/play hand-off and scheduled detail/countdown—with desktop/mobile PNG and WebM recordings. The existing evidence pipeline derives GIF files and uploads the complete directory as a CI artifact.

## Scope

- Additive PostgreSQL migrations and RPC replacements.
- New focused Supabase Edge Function and configuration registration.
- League hub/dedicated route HTML, CSS and JavaScript.
- Pure lifecycle/configuration module.
- Unit, contract, local Supabase integration and responsive Playwright journeys.
- Coverage and visual-evidence workflow registration.

## Security and data considerations

- Public directory/read responses never include `join_code`, account IDs, device hashes or competition credentials.
- Private invitation codes remain visible only to the owner through the protected player-league projection and the create response.
- Account ownership is verified before private status/list reads; mutations additionally use normalized nickname moderation and stable hashed device/IP identities.
- Join capacity and identity checks occur while holding a row lock, preventing concurrent bypass.
- No table, column, row, migration history or existing credential is deleted or rewritten.
- Legacy duplicate identities are tolerated as historical data; all new membership writes enforce the stronger invariant without a destructive cleanup migration.

## Acceptance criteria

- [x] `/ligas/<id>` hides creation, invitation, directory and account league lists.
- [x] Dedicated pages show the selected league, status, configuration, classification and applicable actions only.
- [x] **Jugar** appears only for an active member with attempts remaining and opens home with the league selected.
- [x] Directory search and public/private filtering operate through a bounded server projection.
- [x] Private league cards show a lock and cannot be joined by public ID.
- [x] Public league cards can be joined without a private code.
- [x] Creation supports private/public, 10–100 participants by tens, and 1–7 days, with defaults 10 and 3.
- [x] Reaching three distinct accounts/devices schedules a 23-hour countdown exactly once.
- [x] Scheduled leagues cannot reserve or start attempts.
- [x] Capacity cannot be exceeded during concurrent joins.
- [x] One account/device cannot occupy multiple places in the same league.
- [x] New pure decision logic has enforced 100% line, function and branch coverage.
- [x] Desktop and mobile tests cover directory, active, scheduled, joining and selected-home hand-off.
- [x] CI produces complete viewport PNG/WebM/GIF evidence for remote review.

## Validation plan

- `pnpm check`
- `pnpm test:league-directory:coverage`
- `pnpm test:e2e`
- `pnpm test:supabase`
- `pnpm check:migrations`
- Supabase clean reset, migration lint and local Edge Function integration.
- Browser console/network inspection in both configured Playwright projects.
- Final PR CI and uploaded `frontend-previews-<run-id>` artifact inspection.

## Risks

- A scheduled league has `activated_at` populated before gameplay begins. All gameplay gates therefore use the explicit phase (`starts_at <= now < ends_at`), not `activated_at` alone.
- Existing clients still calling legacy three-argument RPCs receive the same default settings and scheduled lifecycle. This preserves API compatibility without preserving obsolete immediate-start behavior.
- Static social cards may describe a league using a revision timestamp that does not change every second. The card remains correct at the phase/configuration level; the browser renders the live countdown.
- The public directory exposes league names and public identifiers by design. Private membership credentials and identities remain excluded.

## Rollback

Revert the frontend, Edge Function, tests and RPC definitions with a forward migration. The additive columns and constraints may remain unused safely. Do not delete applied migrations or mutate production migration history.

## Delivery

- Branch: `agent/feat-league-directory-scheduling`
- Base: `main` at `689038e6f43f301cecd0b68e88a1fd87ac39558e`
- Pull request: `#37`
- Visual evidence: Actions artifact `frontend-previews-30217350042` with PNG, GIF and WebM files for three desktop/mobile journeys.
- Temporary evidence branch: removed.
- Merge/deployment: not authorized.

## Status

Implementation complete. Quality, lint, dead-code, security, local Supabase integration, 100% isolated module coverage, desktop browser and mobile browser pipelines passed on the implementation commit. The pull request contains the remote evidence download and is ready for the final head CI verification.
