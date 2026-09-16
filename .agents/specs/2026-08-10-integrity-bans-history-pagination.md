# Integrity policy v3, temporary bans and bounded profile history

## Request

Harden the ranked integrity system after a confirmed evasion pattern where algorithm-assisted near-perfect attempts are interleaved with manual attempts on the same account so suspicious results are not consecutive. When a malicious session is established with corroborating evidence, revoke suspicious recent results, repair ranking/rewards/averages/achievements, and temporarily block further ranked play for 48 hours.

Add one forward migration that deterministically upgrades existing history once. Preserve raw attempt evidence and avoid false positives from skilled players or shared IP addresses.

Make an exact 10.600-second verified result an epic achievement with materially higher points. Prevent large public player profiles from growing without bound by paginating histories and achievement collections, and group repeated achievement occurrences behind collapsed-by-default date details.

## Evidence

- Policy v2 evaluates near-perfect attempts in a 24-hour window, but exclusion requires repeated fingerprint evidence plus either three same-device nicknames or four automation-shape matches. A single account/nickname can therefore interleave manual attempts with assisted attempts and delay or evade the exclusion gate.
- `game_attempts` already stores immutable raw timing, device/IP hashes and client telemetry while `game_attempt_integrity` owns the reversible eligibility projection. Existing reconciliation already repairs referrals, daily trophies, league trophies, achievements and featured-achievement validity when `verified` changes.
- Browser telemetry is attacker-controlled evidence, not an authorization boundary. Server challenge state, server/client timing and single-use proofs remain the hard security boundaries.
- An IP address can represent multiple legitimate users because of household networks, institutional networks, CG-NAT and VPNs. IP alone must not convict or revoke unrelated players.
- `perfect_total_1` currently awards only 15 points even though exact 10.600 is the strongest precision milestone.
- `player.js` renders up to 20 attempts at once, the full achievement catalogue at once and the complete trophy history at once. Repeated achievement families such as monthly/category/date-scoped awards can also create visually repetitive history.

## Decisions

1. Upgrade the centralized integrity policy to version 3. Keep the 24-hour evidence model for long-window context and add a two-hour same-account/same-device session model that evaluates the complete sequence, not only consecutive attempts.
2. Precision alone never proves cheating. A malicious session requires near-perfect repetition plus corroborating automation/fingerprint/alternation evidence bound to a strong identity (canonical account and/or persisted device).
3. Add explicit session evidence: total attempts, near-perfect attempts (`<=5 ms`), very-near attempts (`<=2 ms`), ordinary attempts, repeated automation-shape observations, repeated fingerprint observations and transitions between near-perfect and ordinary attempts during the previous two hours.
4. A same-account/same-device alternating pattern can become malicious even with one nickname. Manual attempts inserted between assisted attempts therefore do not reset evidence.
5. On a confirmed malicious session, mark the suspicious hard-valid `<=5 ms` attempts in that two-hour account/device cluster `excluded`; do not delete or rewrite raw elapsed time, telemetry or challenges.
6. Reuse `reconcile_game_integrity_attempts()` after projection changes. Ranking, averages, daily/league trophies, referrals, achievements and featured achievements therefore derive from the corrected verified history instead of introducing a second cleanup flow.
7. Add a private append-only `game_integrity_bans` ledger. A confirmed malicious session creates 48-hour account and device bans. IP bans are issued only when the same IP has low device sharing in the evaluated two-hour window; a shared IP can add risk but cannot independently ban or revoke unrelated accounts.
8. Expose one canonical `get_game_active_integrity_ban(account/device/ip)` function. Edge Functions check it before spending Turnstile/human-check proofs, and the database challenge-start functions enforce it again as defense in depth.
9. Ban records are immutable audit records; expiry is derived from `triggered_at + 48 hours`. No update/delete privilege is granted to API roles or service role.
10. The new migration is forward-only and executes the policy-v3 historical rebuild exactly once when applied. Historical bans use the suspicious anchor timestamp, so old incidents naturally produce already-expired bans while still correcting historical ranking/reward projections.
11. Never hard-code a nickname, account, device or IP for cleanup. The one-time rebuild applies the same deterministic policy to all historical evidence.
12. Increase the first exact-10.600 achievement to 100 points and rebalance cumulative perfect milestones upward so an epic first exact result is not worth more than later mastery milestones. Only currently verified attempts can unlock/retain precision achievements.
13. Add a reusable, deterministic client pagination module. Attempts, achievement catalogue and trophy history render bounded pages with accessible previous/next controls and page status; pagination resets/clamps when the underlying dataset changes.
14. Group repeated earned achievement occurrences by their catalogue family. Show one primary card and a native `<details>` section, collapsed by default, containing the occurrence dates. The date list is itself bounded/paginated when needed. Native disclosure semantics preserve keyboard and screen-reader behavior.
15. Do not paginate the four-card trophy-category objective summary; paginate only unbounded histories/collections.

## Policy v3 guardrails

The exact thresholds are implementation-owned in `game_attempt_integrity_decision()` and must have real-DB boundary tests. The policy must satisfy these invariants:

- one, two or several legitimate near-perfect results with varied human telemetry remain eligible;
- precision-only evidence never produces `excluded`, `malicious=true` or a ban;
- IP-only evidence never produces `excluded`, `malicious=true` or a ban;
- manual attempts between assisted near-perfect attempts do not erase the two-hour session evidence;
- a repeated zero-motion/user-activation-gap near-perfect shape on one canonical account/device can reach malicious state without requiring multiple nicknames;
- a repeated matching interaction fingerprint plus a sufficiently alternating near/ordinary sequence can reach malicious state without requiring multiple nicknames;
- a high-confidence very-near alternating statistical pattern may corroborate malicious state only when bound to the same canonical account/device and enough observations exist; it cannot be triggered by a small sample;
- the exact two-hour lower boundary is included, while one millisecond older and future attempts are excluded from session evidence;
- shared-IP activity across several devices suppresses IP-ban issuance while account/device enforcement remains active;
- ban expiry at exactly 48 hours is not active; one millisecond before expiry is active.

## Achievement points

Perfect-attempt progression becomes:

- `perfect_total_1`: 100 points, epic exact-10.600 milestone;
- `perfect_total_3`: 150 points;
- `perfect_total_5`: 225 points;
- `perfect_total_10`: 350 points;
- `perfect_total_25`: 650 points;
- `perfect_total_50`: 1000 points;
- `perfect_total_100`: 1600 points;
- `perfect_average`: 300 points.

The migration rebuilds achievements after integrity correction so historical point totals and ranking tie-breaks use the new values consistently.

## Scope

### Included

- Policy-v3 evidence, decision, reassessment and deterministic historical rebuild.
- 48-hour account/device bans and conditional low-sharing IP bans.
- Edge + database ban enforcement before ranked attempt preparation.
- Retroactive two-hour suspicious-attempt exclusion and existing reward reconciliation.
- Exact-time achievement point rebalance and achievement rebuild.
- Profile attempt/achievement/trophy pagination.
- Grouped repeated-achievement dates using collapsed native disclosure.
- Accessibility, mobile reflow, keyboard focus and responsive browser evidence.
- Real PostgreSQL/Supabase policy coverage, unit tests and Desktop/Mobile Playwright acceptance.

### Excluded

- Deleting raw attempts or integrity audit events.
- Permanent bans.
- Treating an IP address as a person.
- Public exposure of account/device/IP hashes, ban evidence or internal risk reasons.
- Manual production data edits.
- Remote migration execution, merge, deployment or release without explicit authorization.

## Acceptance

- [ ] Alternating assisted near-perfect and manual attempts on the same account/device are evaluated as one two-hour sequence and cannot reset the detector by interleaving manual attempts.
- [ ] A confirmed malicious sequence retrospectively excludes the suspicious `<=5 ms` attempts in its two-hour strong-identity cluster.
- [ ] Existing ranking, averages, daily trophies, league trophies, referrals, achievements and featured achievements are reconciled after those exclusions.
- [ ] Legitimate skill/precision alone remains ranking-eligible and does not create a ban.
- [ ] Shared IP alone remains non-convicting; unrelated devices on a shared IP are not revoked or blocked.
- [ ] Confirmed malicious activity creates an immutable 48-hour account ban and device ban.
- [ ] IP ban is created only when the evaluated IP is not meaningfully shared; shared-IP suppression is covered at both sides of the threshold.
- [ ] Ranked preparation rejects active bans before consuming Turnstile/human-check proof and returns a bounded, user-readable expiry/retry response.
- [ ] Database start/prepare functions independently enforce the active ban even if an Edge Function check is bypassed.
- [ ] Ban expiry exact-boundary behavior is deterministic.
- [ ] Migration backfill runs the policy-v3 rebuild once and does not create a recurring full-history scan.
- [ ] Raw attempt timing, telemetry and challenge evidence remain unchanged after rebuild/revocation.
- [ ] `perfect_total_1` is worth 100 points and all perfect progression points follow the documented monotonic scale.
- [ ] Achievement rebuild removes exact/precision achievements whose qualifying attempts become excluded.
- [ ] Attempts, achievements and trophy history render bounded pages with accessible controls and deterministic clamping/reset behavior.
- [ ] Repeated achievement occurrences render one grouped item with dates behind a collapsed-by-default disclosure.
- [ ] Pagination/disclosure works at 320px, desktop and keyboard-only navigation without horizontal overflow or lost focus.
- [ ] New isolated JavaScript decision/state modules have 100% line/function/branch coverage.
- [ ] Every new policy-v3 threshold, gate, boundary, ban scope, revocation path, rebuild path, permission path and concurrency owner has executable real-DB coverage.
- [ ] Empty-database migration, incremental integration, API journey, Desktop/Mobile Playwright, security checks and full CI are green on the final PR head.
- [ ] No merge, deployment, release or production migration occurs without explicit authorization.

## Tests

### PostgreSQL/Supabase

Extend `scripts/test-integrity-policy-coverage-local.mjs` with:

- every new policy-v3 score interval and exact state threshold;
- insufficient-sample and precision-only false-positive controls;
- same-account/same-device manual/assisted alternation;
- non-consecutive suspicious attempts retaining session evidence;
- exact `2h`, `2h + 1ms` and future boundaries;
- same account on another device and same device across another account;
- shared-IP suppression and low-sharing IP-ban issuance;
- exact 48-hour active/expired ban boundary;
- duplicate malicious reevaluation is idempotent and does not duplicate equivalent active bans;
- immutable ban-ledger permissions and API-role isolation;
- account/device/IP ban lookup precedence;
- challenge preparation blocked under active account/device/IP ban and allowed after expiry;
- retroactive suspicious-attempt exclusion only within the intended two-hour cluster;
- unrelated/manual/older attempts preserved;
- reward/referral/achievement repair after retroactive exclusion;
- one-time forced v3 rebuild determinism and subsequent non-forced no-op;
- raw attempt evidence invariance.

### Unit/security

- Static contract tests require policy version 3, 2-hour evidence, immutable ban table, conditional IP ban and one-time migration rebuild.
- Pagination module: empty, one page, exact page size, page-size+1, first/last page, clamp after shrink, reset after new dataset, deterministic ranges and invalid input normalization at 100% line/function/branch coverage.
- Achievement grouping: no repeats, same family repeats, date ordering/deduplication, unknown earned codes, featured primary occurrence and empty dates at 100% line/function/branch coverage.
- Exact achievement point catalogue and SQL contract stay synchronized.

### Browser

Desktop and Mobile Playwright verify:

- attempts/history pagination;
- achievement pagination;
- trophy-history pagination;
- repeated achievement date disclosure starts collapsed, opens by pointer and keyboard, and retains bounded layout;
- feature-selection editing remains correct while achievement pages change;
- no 320px overflow and sensible focus after pagination.

## Rollback

Do not edit or remove an applied migration. Roll back application code only if necessary while preserving raw attempts, integrity states/events and ban ledger. Any policy correction after deployment must be a new forward migration and deterministic rebuild. A false-positive ban naturally expires and can be superseded by a future policy decision; raw history remains available for audit.

## Delivery

- Branch: `agent/security-integrity-bans-pagination`
- Base: `main`
- One normal non-draft pull request after implementation.
- `agent/ci-lock-resolver` is obsolete and authorized for deletion, but branch deletion is not exposed by the currently available GitHub connector; do not repurpose or force-move it.
- No merge, deployment, release or production migration is authorized.

## Status

In progress.
