# Zadmin attempt review and risk scoring

## Request

Improve the protected `/zadmin/` workflow so an active operator session is not interrupted by the current fixed 30-minute browser countdown, allow an administrator to invalidate or restore individual ranked attempts without deleting raw evidence, and increase the integrity risk score for concentrated extreme timing sessions such as repeated 1–3 ms results while preserving the existing false-positive rule that precision alone cannot automatically convict a player.

## Evidence

- `game_admin_sessions` currently issues a fixed 30-minute expiry and `zadmin_validate_session` updates only `last_seen_at`; the browser independently clears the token when the original expiry is reached.
- Admin bearer tokens are already random, stored only as a server-side hash, bound to the login IP/device fingerprints, and kept only in browser memory.
- `game_attempt_integrity_decision()` currently gives three near-perfect attempts only 10 points for `sameDeviceNearPerfect >= 3` plus 10 for `sessionNearPerfect2h >= 3`. It does not score the stronger combination where the whole early two-hour sample is near-perfect and at least two attempts are `<= 2 ms`.
- Policy v3 intentionally prevents precision or shared IP evidence from convicting on their own. This safety boundary must remain.
- Raw attempt history is intentionally retained and reward/ranking projections are already reconciled from canonical attempt verification state.
- Zadmin destructive interactions use application-owned inline components and must not introduce native browser alerts, prompts, confirms, dialogs, or modal APIs.

## Decisions

### Admin session

Keep bearer tokens memory-only and bound to IP/device. Replace the fixed operator-facing 30-minute lifetime with a 12-hour sliding idle window:

- session creation expires after 12 hours;
- every successfully authenticated zadmin request extends `expires_at` to at least `now + 12 hours`;
- the browser no longer clears an otherwise valid session based on the original login timestamp;
- the server remains authoritative for expiry and explicit logout/revocation;
- no token is persisted in localStorage/sessionStorage/cookies.

This avoids forced logout during active administration without creating an unbounded stolen-token lifetime.

### Individual attempt invalidation

Do not delete or mutate raw timing/evidence fields. Add an append-only administrative attempt-action ledger with `invalidate` and `restore` actions.

- Every action requires a valid admin session and a 3–500 character reason.
- The latest ledger action is the manual override state for the attempt.
- Invalidating an attempt forces the compatibility projection `game_attempts.verified = false` and invokes the existing canonical integrity reconciliation for affected rankings/rewards.
- Restoring removes the manual override by appending a `restore` action and then runs the canonical integrity reassessment; the attempt only becomes verified if the normal integrity engine allows it.
- A database guard prevents later integrity rebuilds from re-enabling an attempt while its latest manual state is `invalidate`.
- The raw attempt row and technical evidence remain available for audit.
- Admin audit history records attempt invalidation/restoration alongside ban actions.

### Risk scoring

Keep policy-v3 automatic exclusion gates unchanged, but strengthen its review score using evidence fields the engine already owns. The extra boost is intentionally limited to concentrated early samples of 3–5 attempts so long-running sessions keep the existing calibration rather than accumulating duplicated timing weight:

- add 25 risk points when a two-hour strong-identity sample contains 3–5 attempts, at least 3 near-perfect attempts, and at least 2 very-near (`<=2 ms`) attempts;
- add 15 risk points when a two-hour sample contains 3–5 attempts and every attempt is near-perfect (`<=5 ms`);
- add explicit reasons `two_hour_extreme_precision_burst` and `two_hour_all_near_perfect`;
- cap at 100 as before;
- snapshot the conviction score before these two review-only boosts;
- do not use either new signal as an automatic malicious/exclusion gate.

The observed three-attempt pattern `1 ms, 2 ms, 3 ms` on one account/device therefore rises from 20/100 to 60/100 (10 long-window frequency + 10 two-hour frequency + 25 extreme burst + 15 all-near), becoming `watch` while still requiring corroboration or human review for exclusion. An eight-attempt precision-only sample retains the existing 75/100 review score rather than receiving the early-session bonus again.

## Scope

### In scope

- forward-only database migration for sliding admin sessions, attempt override ledger/functions/view projection, audit constraints, and enhanced risk scoring;
- zadmin Edge API actions for invalidating/restoring an attempt;
- zadmin attempt-card inline controls and session-status copy;
- real local Supabase tests for session renewal, attempt invalidation/restoration, persistence guard, reconciliation and permissions;
- integrity decision matrix coverage for the new score branches and the reported 1/2/3 ms regression;
- Desktop/Mobile Playwright coverage and final visual evidence.

### Out of scope

- deleting raw attempts;
- changing the existing automatic ban duration/scope rules;
- making timing precision alone an automatic conviction;
- persisting admin bearer tokens in browser storage;
- production migration/deployment/merge without explicit authorization.

## UX

- Each recent attempt displays its manual-review state independently from the algorithmic risk badge.
- An eligible/non-manually-invalidated attempt exposes an `Invalidar tiempo` button.
- A manually invalidated attempt exposes a `Restaurar tiempo` button and the latest manual reason/date.
- Selecting either action opens an inline form inside that attempt card with a persistent `Motivo` label, `Cancelar`, and a specific destructive/restorative action button.
- Escape cancels the pending inline action and restores focus to its invoking button.
- Only one attempt action editor may be active at a time; changing entity/view/session cancels stale pending state.
- No browser-native alert, confirm, prompt, `<dialog>`, `showModal()` or equivalent is permitted.
- Controls remain keyboard operable and target at least the existing 44px mobile interaction standard.

## Acceptance criteria

- [ ] An authenticated zadmin session is renewed on use and is not locally cleared after the original login expiry timestamp.
- [ ] Session token remains memory-only, IP/device-bound, explicitly revocable and server-expiring after 12 hours without authenticated use.
- [ ] Wrong IP/device and revoked/idle-expired sessions remain invalid.
- [ ] Any existing ranked attempt can be invalidated individually with a mandatory reason.
- [ ] Invalidating does not delete or alter raw timing/client evidence.
- [ ] Invalidated attempts stay `verified=false` through subsequent integrity reassessment/rebuild attempts.
- [ ] Invalidating triggers canonical reward/ranking reconciliation.
- [ ] A manual invalidation can be restored by appending a restore action; canonical integrity policy then decides effective verification.
- [ ] Attempt actions are append-only, RLS protected and unavailable to anon/authenticated browser roles.
- [ ] Admin audit includes invalidate/restore attempt events.
- [ ] A 1/2/3 ms three-attempt strong-identity session scores 60/100 and `watch` under the enhanced risk model.
- [ ] A precision-only sample outside the early 3–5 attempt window keeps the existing score calibration.
- [ ] Timing-only evidence still cannot set `malicious=true` or automatically exclude an attempt.
- [ ] Existing corroborated policy-v3 malicious cases remain excluded.
- [ ] New score branches are exercised by the real PostgreSQL security suite.
- [ ] Zadmin attempt controls are inline components with no native browser modal primitives.
- [ ] Desktop, Mobile and 320px journeys remain operable without global overflow.
- [ ] Final-head quality, Supabase, browser, security, CodeQL, public-asset and visual-evidence checks are green.

## Tests

- Unit/security: zadmin core/session constants and static contracts for the new API/database boundary.
- Real PostgreSQL/Supabase:
  - session creation, sliding renewal, original-expiry survival, exact renewed idle expiry, wrong IP/device and explicit revocation;
  - attempt invalidate, duplicate/no-op handling, raw-field preservation, verified projection, restore + canonical reassessment, guard against re-enable, audit rows and role isolation;
  - risk scoring boundaries for extreme-burst/all-near signals, score cap, 1/2/3 regression, long-sample baseline and precision-only non-conviction.
- E2E Desktop/Mobile: inline invalidation editor, validation, cancel/Escape/focus recovery, successful invalidation/restoration, refreshed attempt state, token still memory-only and session copy.
- Visual: final `/zadmin/` dashboard Desktop/Mobile PNG plus interaction recording/GIF from the final PR head.

## Risks

- Manual invalidation changes derived rankings/rewards. Mitigation: use the existing reconciliation owner and preserve an append-only audit trail plus reversible restore action.
- A long-lived admin token increases compromise impact. Mitigation: 12-hour sliding idle expiry, browser-memory-only storage, IP/device binding, no cookies/storage, explicit logout/revocation.
- Increasing timing risk can create more false review positives. Mitigation: the new evidence only raises `watch` risk, is bounded to concentrated early samples and cannot make `malicious=true` by itself.
- Existing applied migrations must never be edited. All database changes are forward-only.

## Rollback

Revert frontend/API behavior normally. If the migration has been applied, use a new forward migration to disable new RPC entrypoints or adjust scoring; do not rewrite the applied migration. Manual action rows and raw attempts remain retained for audit.

## Delivery

- Branch: `agent/feat-zadmin-attempt-review-risk-scoring`
- One normal non-draft PR targeting `main`.
- No production migration, deployment, release or merge without explicit authorization.

## Status

Implementation is complete. Merge readiness is determined exclusively by the required checks and final-head visual evidence attached to the current PR head.
