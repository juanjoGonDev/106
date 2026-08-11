# Play restriction visibility and zadmin session restore

## Request

Fix three production-facing administration/gameplay regressions:

1. When ranked access is temporarily blocked, show the restriction directly inside the play setup panel before the user presses `Comenzar`, disable the start action, show a live countdown when the restriction is timed, and explain the reason in user-safe language.
2. Make zadmin explain automatic integrity restrictions as well as manual operator bans so an operator can understand why gameplay is blocked when no `game_admin_bans` row exists.
3. Preserve an authenticated zadmin session across a normal page reload in the same browser tab/session while keeping server-side IP/device binding, explicit logout/revocation and the 12-hour sliding idle window authoritative.

## Evidence

- Production surfaced `integrity_banned` only after the user tried to start a ranked flow. `game-api` returned `expiresAt` and `retryAfterSeconds`, but the setup panel had no restriction state and `competition.js` did not proactively request the canonical restriction lookup.
- The canonical ranked lookup composes two different sources: manual `game_admin_bans` first, then automatic policy-v3 `game_integrity_bans`. Automatic restrictions may target account, device or IP and last 48 hours.
- Zadmin's previous `fetchBans()` read only `game_admin_bans`; its summary and detail could therefore say there were no manual bans while an automatic policy-v3 restriction was active.
- `game_integrity_bans` is service-role-readable and already stores scope, reason, source attempt, timestamps, policy version and evidence. Browser roles remain denied.
- `player-context` already resolved the account token and had the server-side hash pepper, but did not accept the gameplay device identifier or resolve the effective ranked restriction.
- `competition.js` already owned the pre-start availability state and `startButton` enablement, making it the correct UI owner for a proactive restriction state.
- Zadmin previously stored only its stable device identifier in `localStorage`; the bearer token lived only in a module variable, so any reload returned to login even while the server session remained valid.

## Decisions

### Canonical gameplay restriction status

Reuse the existing database owners rather than adding a second ban system.

- `player-context` accepts the existing gameplay `x-device-id` header, hashes device/IP with the same `HASH_PEPPER` domains used by `game-api`, and resolves the current effective restriction.
- For a concrete nick, call the canonical nick-aware restriction owner so manual nick bans are included as well as account/device/IP restrictions.
- For account context without a nick, call the canonical token-aware restriction owner.
- Return a narrow public restriction projection only: active state, source (`manual` or `integrity`), scope, expiry/permanent flag and retry duration. Do not expose automatic integrity evidence, source attempt IDs, raw fingerprints or operator-only notes to the player.
- Player-visible reason text is intentionally coarse so the UI explains which restriction class/scope applies without revealing anti-cheat detection internals.

### Play panel UX

- Add one inline restriction component inside the existing setup panel, immediately before the primary start action.
- When active, it shows a clear title, user-safe reason, restriction source/scope and either a live countdown plus end date or a permanent-state label.
- `competition.js` includes restriction state in `canStart()`, so `#startButton` stays disabled before any CAPTCHA/human-check/start request is spent.
- While blocked, the start button text reflects the blocked state instead of inviting the user to begin.
- The countdown is derived from absolute `expiresAt`, not from decrementing a client counter, so background-tab throttling or clock ticks cannot accumulate drift.
- At expiry, refresh player context and only re-enable play if the server confirms the restriction has ended.
- If the expiry recheck fails, remain fail-closed: keep the action disabled and explain that server confirmation is still pending.
- The component is `aria-live="polite"`; only the visible countdown changes once per second and no modal is used.
- Permanent manual restrictions show no false countdown.

### Zadmin automatic restrictions

Keep manual and automatic restrictions distinct.

- `zadmin-api` reads the existing private `game_integrity_bans` ledger with service role.
- Overview reports both active manual bans and active automatic integrity restrictions.
- Entity detail returns manual bans plus automatic restrictions related to the selected account/nick/IP through the entity's known account/device/IP correlations.
- The restrictions tab renders two clearly labelled groups: manual operator bans (revocable) and automatic integrity restrictions (read-only).
- Automatic rows show scope, expiry context, policy version, source attempt and the stored integrity reason/evidence required for operator investigation.
- Automatic restrictions remain immutable from zadmin; this change does not add a revoke/delete control for the policy-v3 ledger.

### Zadmin reload persistence

Use `sessionStorage` as the narrow persistence boundary.

- On successful login, store only the opaque admin bearer token in `sessionStorage` under a dedicated versioned key.
- Do not store username, password or token in `localStorage`, cookies or IndexedDB.
- `sessionStorage` is chosen because it survives reloads in the same tab/session but is not durable browser profile storage.
- On page initialization, if a token is present, validate it immediately through an authenticated lightweight zadmin request before showing the dashboard.
- The server remains authoritative: wrong IP/device, revoked token or idle expiry returns 401 and clears the stored token before showing login.
- Explicit logout clears `sessionStorage` even if the network request fails.
- Until restore validation completes, keep both login and dashboard in a neutral restoring state to avoid flashing an authenticated dashboard for an invalid token or flashing the login form for a valid one.

## Scope

### In scope

- `player-context` effective restriction projection and device/IP hashing.
- `competition.js` restriction state, countdown and start gating.
- Existing game page styling for the inline restriction component.
- zadmin Edge API automatic-restriction queries and correlation.
- zadmin UI for manual vs automatic restriction visibility.
- zadmin `sessionStorage` restore/clear lifecycle.
- Deterministic unit/security, real local Supabase and Desktop/Mobile Playwright regressions.
- Required platform visual evidence for changed game/zadmin states.

### Out of scope

- Changing policy-v3 detection thresholds or 48-hour automatic-ban duration.
- Automatically revoking policy-v3 bans from zadmin.
- Exposing raw IP addresses or unpeppered identifiers.
- Changing manual ban duration rules.
- Persisting admin credentials.
- Production merge/deploy or remote migration execution without explicit authorization.

## Acceptance criteria

- [x] An active ranked restriction is visible in the setup panel before any start/human-check request.
- [x] `#startButton` is disabled while an effective restriction is active even when nick/team/attempt quota are otherwise valid.
- [x] Timed restrictions show a live countdown derived from server `expiresAt` and a human-readable end time.
- [x] Permanent manual restrictions show a permanent label instead of a fake countdown.
- [x] The play panel explains manual vs automatic restriction and the affected scope without revealing internal integrity evidence.
- [x] At countdown expiry the browser rechecks the server before enabling play and remains blocked if confirmation fails.
- [x] Player-context includes manual nick bans and account/device/IP effective restrictions via existing canonical DB owners.
- [x] A current automatic integrity restriction is visible in zadmin even when there are zero active manual bans.
- [x] Zadmin overview distinguishes active manual vs automatic restriction counts.
- [x] Zadmin detail shows related automatic scope, expiry, source attempt, reason/policy/evidence for operator diagnosis.
- [x] Automatic integrity restrictions are read-only in zadmin.
- [x] Successful zadmin login stores the opaque bearer token in `sessionStorage`, never `localStorage`.
- [x] Reload in the same tab restores the dashboard only after server validation succeeds.
- [x] Invalid/expired/revoked/wrong-bound restored tokens are cleared and return to login through the existing server validation boundary.
- [x] Explicit logout clears the persisted session token even if the revoke request fails.
- [x] Password/username are never persisted.
- [x] No native browser alert/confirm/prompt/dialog is introduced.
- [x] Desktop, Mobile and 320px layouts have no global horizontal overflow and keyboard/focus behavior remains valid in the changed journeys.
- [x] Relevant unit/security, Supabase integration, browser, CodeQL, build, lint and Knip checks are green on the validated functional head. Final-head validation is repeated after this documentation commit.

## Test design

### Unit/security

- Restriction normalization/countdown: inactive, future expiry, exact expiry, invalid expiry, permanent, day/hour formatting and public reason/scope copy.
- New isolated restriction decision module is enforced at 100% lines, functions and branches.
- Static contract: player-context accepts `x-device-id`, uses canonical restriction RPCs and does not expose automatic evidence to players.
- Static zadmin contract: `sessionStorage` token persistence exists while `localStorage` token persistence remains forbidden; credentials remain unpersisted.
- Zadmin API contract: automatic ledger is selected service-side and remains read-only.

### Real Supabase

- Seed a production-shaped automatic device restriction through the existing `game_integrity_bans` service-role table boundary.
- Call the real local `player-context` Edge Function with the matching device identifier.
- Assert the Edge response reports an active automatic device restriction while excluding evidence, internal reason, source attempt and raw hashes.
- Preserve existing RLS/permission isolation; notably, the test does not grant service-role EXECUTE on the intentionally private `issue_game_integrity_ban` owner.
- Existing real suites continue to cover canonical manual/automatic restriction owners, expiry and authorization behavior.

### Browser

- Game Desktop/Mobile: deterministic active timed restriction renders before start, start remains disabled, countdown is derived from absolute expiry, no verification/start request fires, and server refresh occurs on expiry.
- Game failure path: an expired restriction remains fail-closed if the server recheck fails.
- Game permanent restriction: renders permanent state with no countdown drift and remains usable at 320px without global overflow.
- Zadmin Desktop/Mobile: login, reload same page, restored dashboard without re-entering credentials, bearer remains authorized, logout clears restore token.
- Zadmin automatic restriction fixture: automatic restriction visible separately from zero manual bans in overview, list and entity detail.
- Check keyboard/focus behavior and responsive overflow for the changed flows.

## Security notes

- `sessionStorage` increases exposure compared with memory-only storage because same-origin script can read it. This is an explicit UX trade-off required for reload persistence. The token remains opaque, server-hashed, IP/device-bound, revocable and idle-expiring; no durable `localStorage`/cookie persistence is introduced.
- Player-facing restriction messages do not reveal policy reasons/evidence that would help tune automation against the detector. Full evidence remains restricted to authenticated zadmin.
- A client countdown never authorizes play; only a fresh server context after expiry can remove the UI gate.
- Expiry revalidation fails closed: a network/server failure cannot transform an old restriction into local authorization.

## Validation

Functional head `8edf10ca5c6aed52d6061a014f5723d215a64096`:

- Pull Request Quality Pipeline `31478986389`: success.
  - Unit/security, build, ESLint, Knip and security policy jobs passed.
  - Supabase `security`, `auth-browser`, `gameplay-core`, `gameplay-sharing`, `migrations`, `ready-flow` and `auth-api` jobs passed.
  - `Supabase · security` executed the real PostgreSQL/PostgREST/Edge journey proving a device integrity restriction is returned by `player-context` without detector evidence leakage.
- Player Pages and Social Cards `31478986300`: success.
- Authentication Quality `31478986283`: success.
- Public Asset Audit `31478986334`: success.
- CodeQL Advanced `31478986262`: success.
- Functional-head platform evidence artifact: `platform-evidence-31478986300`.
  - Artifact digest: `sha256:4a41bdb90cc823d9a7d9a65708ade059eef30324b8be51a9190cdd085c2decf7`.
  - Artifact head SHA matches `8edf10ca5c6aed52d6061a014f5723d215a64096`.
  - Desktop/Mobile review confirms the restriction is rendered inline with source/scope, countdown and disabled start action; zadmin shows `0` active manual bans alongside `1` active automatic restriction and exposes the automatic evidence only inside the authenticated admin view.
- Pull Request Visual Evidence on the functional head is intentionally not treated as complete because its PR-body artifact reference has not yet been updated; the final-head artifact will be linked after the documentation commit and then the gate will be revalidated.

## Rollback

Revert frontend/Edge changes. No database migration is required by this task. Existing manual and policy-v3 ban ledgers remain unchanged.

## Delivery

- Branch: `agent/fix-play-restriction-admin-session`
- Pull request: `#73`.
- One normal non-draft PR targeting `main`.
- No merge, deployment, secret change or remote data mutation without explicit authorization.

## Status

Implementation and functional-head validation are complete. Final completion requires the same required checks plus final platform evidence on the documentation head created by this update.