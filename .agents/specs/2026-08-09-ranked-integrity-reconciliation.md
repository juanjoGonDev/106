# Ranked integrity reconciliation and reward correction

## Request

Replace brittle one-rule anti-cheat exclusions with a centralized, retrospective integrity assessment that combines independent server-observable risk signals without treating excellent timing or a shared IP as proof of cheating. When later evidence makes an attempt ineligible, recompute every dependent competitive result: global ranking eligibility, daily trophies, league trophies, trophy/precision/activity achievements and featured-achievement validity. Reassign a trophy to the player who should have won that date or league when an eligible successor exists; otherwise leave the category unawarded.

Centralize daily award calculation for any Madrid calendar date so current provisional awards, historical persistence, reconciliation and profile progress all consume one canonical backend calculation.

The integrity-policy change is not deliverable until every known policy-v2 decision branch, threshold boundary, gate, state transition, reconciliation outcome, canonical advisory-lock contention path and privilege edge has executable regression coverage against the real local PostgreSQL/Supabase stack. Existing JavaScript 100% coverage gates remain mandatory and may not be weakened. Because this repository does not instrument PL/pgSQL source-line coverage, “100% policy coverage” means complete executable coverage of the enumerated policy-v2 behavioral decision surface rather than an invented PL/pgSQL line-coverage percentage. The PR must not be merged until all required CI checks are green.

## Evidence

- The previous canonical `finish_game_attempt` marked the third result within 5 ms during 24 hours as unverified when either the device hash or IP hash matched. This treated a weak shared-network identifier like a strong identity and used precision alone as a decisive rule.
- The same function excluded an exact repeated interaction fingerprint immediately after two prior matches, even though browser telemetry is attacker-controlled and PR #60 explicitly downgraded client signals to telemetry rather than authorization.
- PR #60 already established hard server boundaries for single-use challenge state, persisted device identity and bounded server/client timing; these remain the immediate rejection conditions.
- `award_game_trophies_for_date()` and `get_game_daily_awards()` independently implemented Golden Boot, Golden Glove and Golden Ball ordering. `get_game_player_honours_progress()` had a third current-day implementation.
- `sync_game_trophy_history()` only filled missing dates and could not correct a persisted winner after integrity changes.
- `sync_game_league_trophies()` only inserted a missing champion and could not replace a champion whose winning attempt later became ineligible.
- Trophy and progression achievements were append-only, and featured achievement rows could remain active after the qualifying history became invalid.
- Production snapshot validation assumed verified attempts, trophies and achievements were monotonic, which conflicted with deliberate retrospective fraud correction.
- The first integrity implementation used a distinct `integrity-referral:<account>` advisory-lock namespace while live referral completion used `referral-complete:<account>`, permitting two writers of the same derived `completed_at` projection to race.
- Same-device reassessment also needed explicit serialization so concurrent finishes cannot calculate the same cluster from different partially committed histories.

## Decision

1. Preserve `game_attempts` as the raw attempt/evidence record. Add a private `game_attempt_integrity` state per attempt and an append-only integrity event ledger.
2. Keep `game_attempts.verified` as the compatibility projection consumed by existing ranking/profile queries. Its authoritative owner becomes the integrity engine; it may change retrospectively while elapsed time and original telemetry remain unchanged.
3. Classify legacy exclusions into:
   - hard-invalid: every existing failure reason except the two heuristic reasons `repeated_near_perfect_results` and `repeated_interaction_fingerprint`;
   - risk-only legacy signals: those two heuristic reasons, which are eligible for reassessment under the new policy.
4. Do not exclude an attempt because of precision alone. Near-perfect frequency can raise risk, but exclusion requires corroborating strong identity and repeated-interaction evidence. IP correlation is weak evidence and can never independently make an attempt ineligible.
5. Use a versioned deterministic risk policy. Store score, reasons, evidence and evaluation time. `watch` is observable risk but remains ranking-eligible; only `excluded` projects `verified=false`.
6. Reassess a bounded 24-hour cluster when a new near-perfect attempt arrives. A later suspicious pattern may therefore invalidate earlier attempts in the same strong-identity cluster.
7. Serialize same-device reassessment with transaction advisory key `integrity-device:<device-hash>` before calculating mutable cluster evidence. Explicit service-role reassessment and the normal finish path share this lock.
8. Provide a full deterministic rebuild entrypoint so a future policy version can recalculate historical integrity from raw attempts without inventing a second scoring implementation. Rebuild accounting includes both reset writes and reassessment-driven projection changes.
9. Rebuild derived achievements from current authoritative data instead of only appending. Remove invalid achievements and deactivate featured selections that no longer exist.
10. Reconcile referral completion from the current fifth verified global attempt of the referred account. Use the exact same `referral-complete:<account>` advisory-lock namespace as normal completion so live completion and retrospective correction cannot race.
11. Create one canonical `game_daily_award_candidates(date)` calculation. All current-day JSON, historical persistence, reconciliation and current profile progress delegate to it.
12. Historical daily trophies are replaceable derived rows. Reconciliation upserts the rightful candidate, removes a category with no eligible candidate, updates its run ledger, and rebuilds achievements for old/new winners.
13. Finished league trophies are also replaceable derived rows. Reconciliation recomputes the eligible winner from current verified attempts and rebuilds achievements for affected players.
14. Existing raw history remains auditable; correction never deletes attempts, challenges or integrity events. The integrity-event ledger grants service role `SELECT`/`INSERT`, not `UPDATE`/`DELETE`.
15. Snapshot deployment guards continue enforcing monotonic raw/source history, while explicitly treating verified/reward projections as recomputable metrics.
16. Forward migration `20260810002000_ranked_integrity_policy_hardening.sql` reruns the v2 rebuild after installing the serialization fixes so a database applying the migration finishes in state produced by the hardened path.

## Risk policy v2

The policy evaluates hard-valid near-perfect attempts (`difference_ms <= 5`) in a 24-hour window ending at the anchor attempt.

Signals are deliberately asymmetric:

- **Precision frequency**: informational/risk-only. Repeated excellent results increase score but cannot exclude alone.
- **Strong identity**: same device across multiple nicks/accounts is significant. Same canonical account across multiple nicks contributes, but a single skilled player on one identity is not penalized merely for repetition.
- **Repeated interaction fingerprint**: exact repeated normalized client telemetry contributes only as corroborating evidence; it is never an authorization signal.
- **Automation shape**: repeated zero-motion/user-activation-gap observations can corroborate a suspicious repeated interaction pattern.
- **IP correlation**: capped weak evidence for observability only and never satisfies the strong-identity requirement.

### Exact score branches

- Same-device near-perfect frequency: `<3 = 0`, `3 = +10`, `4-5 = +20`, `6-7 = +25`, `>=8 = +30`.
- Distinct nicks on the same device: `<2 = 0`, `2 = +10`, `3 = +25`, `>=4 = +30`.
- Repeated normalized fingerprint: `<2 = 0`, `2 = +10`, `3 = +20`, `>=4 = +25`.
- Repeated automation shape: `<3 = 0`, `3 = +15`, `>=4 = +30`.
- Distinct accounts on the same device `>=2` **or** same-account nicks `>=3`: `+5`, once.
- Same-IP near-perfect `>=6` **and** same-IP devices `>=3`: `+5`, weak context only.
- Aggregate score is capped at `100`.

### State gates

An attempt is `excluded` only if **all** are true:

- score `>=65`;
- same-device near-perfect count `>=4`;
- repeated normalized fingerprint count `>=3`;
- distinct nicks on the same device `>=3` **or** repeated automation-shape count `>=4`.

Otherwise score `>=35` produces `watch`; lower scores remain `eligible`. `watch` continues to rank. High score cannot bypass any exclusion gate.

## Scope

### Included

- Additive PostgreSQL migrations for integrity state/events, scoring, bounded reassessment, serialization hardening and full rebuild.
- Effective `verified` projection synchronization.
- Reversible achievement rebuild and featured-achievement cleanup.
- Referral completion reconciliation with canonical advisory locking.
- Canonical date-based daily award candidates and JSON projection.
- Historical daily trophy reconciliation/reassignment.
- Finished league trophy reconciliation/reassignment.
- Current honours-progress award leaders consuming canonical daily results.
- Production snapshot policy for recomputable derived metrics.
- Real local Supabase regression coverage and static security/SSOT contracts.
- Executable policy-v2 threshold/boundary/state/race/permission coverage matrix.
- Documentation of the new integrity/reward lifecycle.
- Migration-aware player-radar revision synchronization and full desktop/mobile visual evidence required by the repository contract.

### Excluded

- Claiming browser automation is impossible.
- Treating IP as a person or account identity.
- Deleting raw attempt evidence.
- Manual production data edits, remote migration execution, merge or deployment.
- Reconstructing historical duel outcomes that do not retain sufficient canonical winning-attempt identity; this task prevents new ranking/trophy/achievement drift without inventing historical duel evidence.
- Claiming a PL/pgSQL source-line coverage percentage that the repository does not instrument.

## Acceptance

- [x] A player can record multiple near-perfect results on one identity without being excluded solely for skill/precision.
- [x] Multiple players/devices sharing one IP are not excluded solely because of that IP.
- [x] Every exact score threshold branch and the `35`/`65` state boundaries are executable regression cases.
- [x] High score without each required exclusion gate remains `watch` rather than `excluded`.
- [x] A corroborated cross-nick/device repeated-interaction near-perfect cluster can move earlier and later attempts to `excluded`.
- [x] Hard-invalid attempts remain excluded regardless of risk score.
- [x] Legacy heuristic-only invalidations can be restored when policy v2 finds no corroborated fraud evidence.
- [x] Null, malformed and nested telemetry/fingerprint normalization behavior is covered.
- [x] The exact 24-hour lower boundary is included; one millisecond older, future and hard-invalid attempts are excluded from cluster evidence.
- [x] Reassessment is deterministic, idempotent and policy-versioned.
- [x] Concurrent same-device reassessment blocks on the canonical advisory lock.
- [x] Raw attempt timing/telemetry is never deleted or rewritten by integrity reconciliation.
- [x] `game_attempts.verified` matches effective integrity eligibility after reconciliation.
- [x] Removing qualifying attempts removes dependent precision/activity/trophy achievements and invalid featured selections.
- [x] Referral completion/bonus eligibility follows the current fifth verified global attempt, reopens below five, moves when the fifth attempt changes and shares the live-completion advisory lock.
- [x] Runtime contention proves retrospective referral reconciliation blocks on the same advisory key as live completion.
- [x] One backend function owns Golden Boot/Glove/Ball candidate ordering for any Madrid date.
- [x] Current provisional awards and persisted historical awards consume the same candidate calculation.
- [x] Retrospective invalidation reassigns each affected daily trophy to the rightful eligible successor, or removes it when no candidate exists.
- [x] Daily no-successor, empty-date, null/current/future guard and stable-awarded-at idempotency paths are covered.
- [x] Finished-league trophy reconciliation covers waiting/scheduled guards, first champion, idempotency, successor reassignment and no-winner removal.
- [x] Reconciliation repairs historical trophy/achievement state idempotently.
- [x] Service role can append/read integrity events but cannot update/delete the ledger; API roles cannot read private integrity state/events or execute reassessment.
- [x] Forced rebuild preserves raw elapsed time/telemetry, deterministically restores the v2 result and reports reset plus re-exclusion projection writes; a current non-forced rebuild is a no-op.
- [x] Production deployment history guards continue protecting raw history while permitting intentional derived-integrity corrections.
- [x] Empty-database migration and real local integration journeys pass.
- [x] Existing frontend-module coverage remains at the repository's enforced 100% thresholds.
- [ ] Every required CI check is green on the final PR head before merge.
- [x] No merge, deployment, release or production migration occurs while any required check is red.

## Tests and validation

### Policy-v2 executable behavioral coverage

`scripts/test-integrity-policy-coverage-local.mjs` is part of the canonical `Supabase · gameplay-sharing` job and executes against a real isolated local PostgreSQL/Supabase stack. It covers:

- null and negative evidence normalization;
- every near-perfect score interval: `2, 3, 4, 5, 6, 7, 8`;
- every same-device nick interval: `1, 2, 3, 4`;
- every repeated-fingerprint interval: `1, 2, 3, 4`;
- every automation-shape interval: `2, 3, 4`;
- distinct-account and same-account identity context, including the OR branch not double-counting;
- both sides of the weak shared-IP AND condition and the capped `+5` result;
- exact watch threshold `35`;
- all exclusion gates independently prevented despite sufficient aggregate score;
- minimum cross-nick exclusion and automation-shape alternative exclusion;
- risk-score cap `100`;
- hard-valid classification for verified, null/empty reasons, both legacy heuristics, hard failure and mixed legacy/hard reasons;
- telemetry/fingerprint null, non-object, incomplete, root/nested normalization, irrelevant-field stability and relevant-field sensitivity;
- exact 24-hour inclusion, 24-hours-plus-1ms exclusion, future-attempt exclusion and hard-invalid exclusion;
- missing anchor, non-near-perfect anchor, legacy restoration, hard-invalid projection repair, watch propagation, exclusion propagation and repeated-reassessment no-op/event stability;
- daily award persistence, stable timestamps on unchanged candidates, no-successor deletion, run-ledger correction, achievement cleanup, empty award JSON and null/current/future reconciliation guards;
- referral fifth-attempt completion timestamp, idempotency, reopening below five, movement to the next fifth attempt and restoration to the earlier fifth attempt;
- league waiting/scheduled guards, first champion, repeated no-op, successor reassignment, no-winner removal and missing-league guard;
- actual advisory-lock contention for same-device integrity reassessment and referral completion/reconciliation using short PostgreSQL `lock_timeout` probes;
- actual service-role denial of integrity-event `UPDATE` plus privilege assertions for `SELECT`/`INSERT`/`DELETE` and API execution/read boundaries;
- forced full rebuild determinism, raw timing/telemetry invariance, projection-change accounting and non-forced already-current no-op.

This is the complete known policy-v2 behavioral branch and boundary surface. If the policy gains a new signal, threshold, gate, status, derived-reward consumer or lock owner, this matrix and the static coverage contract must be extended in the same change.

### Validated code head

Quality run `31340703055` at head `604e455c302f6dcd9a1bb57bcb3f38130198dd2d` has the following results:

- `Build · Prepare workspace`: passed.
- `Tests · Unit & security`: passed, including the expanded integrity static contract.
- `ESLint`: passed.
- `Knip`: passed.
- `Supabase · security`: passed.
- `Supabase · migrations`: passed from an empty local database.
- `Supabase · gameplay-core`: passed.
- `Supabase · gameplay-sharing`: passed, including the exhaustive real-PostgreSQL policy matrix, canonical trophy suite and reconciliation suite.
- `Supabase · auth-api`: passed.
- `Supabase · auth-browser`: passed.
- `Supabase · ready-flow`: passed, including real ranked desktop/mobile browser journeys.
- `Authentication Quality`, `CodeQL Advanced`, `Public Asset Audit` and `Pull Request Visual Evidence`: passed on the same head.
- `Player Pages and Social Cards` enforced frontend-module 100% coverage successfully. One of sixteen independent visual-capture shards failed before the scenario under test because the randomized human-check click remained at `0 / 4` instead of advancing to `1 / 4`; the other fifteen shards passed. This is tracked as a browser-test flake and is not accepted as green delivery. The final-head run must pass rather than being ignored.

### Current dependency-security blocker

`Security · Dependency & policy checks` still fails `pnpm audit --audit-level=high` on transitive dependencies in the frozen toolchain. The audit reports patched requirements beyond the currently resolved versions for `brace-expansion` through ESLint/minimatch and `nanoid` through Vitest/Vite/PostCSS. Package-policy validation and frozen installation themselves pass.

No audit threshold was lowered, no advisory was ignored, no test was skipped, and no unpublished or unverified package version was invented. Delivery remains blocked until the dependency graph can resolve safe published versions and the complete final-head CI run is green.

## Rollback

Do not rewrite or remove an applied migration. Application rollback may stop invoking reassessment while preserving the new audit tables. Any policy correction after deployment must be a forward migration that updates the versioned scoring/reconciliation functions and reruns the deterministic rebuild. Raw attempts and integrity events remain available for audit and recovery.

## Delivery

- Branch: `agent/security-ranked-integrity-reconciliation`
- Base: `main`
- Pull request: `#66`, normal and non-draft.
- Merge condition: every required final-head CI check is green.
- Merge, deployment, release and production migration execution are not authorized and have not been performed.

## Status

Implementation and task-owned behavioral validation are complete. The exhaustive known policy-v2 branch/boundary/race/permission matrix is green against real PostgreSQL, and the repository's JavaScript 100% coverage gates remain green. Delivery is intentionally blocked while required CI is red: the dependency audit requires safe transitive releases not yet resolved by the frozen graph, and the latest full-platform capture run contained one randomized human-check flake. Do not merge until a final PR head completes with every required check green.
