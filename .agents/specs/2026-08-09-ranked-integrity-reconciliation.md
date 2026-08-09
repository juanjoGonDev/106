# Ranked integrity reconciliation and reward correction

## Request

Replace brittle one-rule anti-cheat exclusions with a centralized, retrospective integrity assessment that combines independent server-observable risk signals without treating excellent timing or a shared IP as proof of cheating. When later evidence makes an attempt ineligible, recompute every dependent competitive result: global ranking eligibility, daily trophies, league trophies, trophy/precision/activity achievements and featured-achievement validity. Reassign a trophy to the player who should have won that date or league when an eligible successor exists; otherwise leave the category unawarded.

Centralize daily award calculation for any Madrid calendar date so current provisional awards, historical persistence, reconciliation and profile progress all consume one canonical backend calculation.

## Evidence

- The previous canonical `finish_game_attempt` marked the third result within 5 ms during 24 hours as unverified when either the device hash or IP hash matched. This treated a weak shared-network identifier like a strong identity and used precision alone as a decisive rule.
- The same function excluded an exact repeated interaction fingerprint immediately after two prior matches, even though browser telemetry is attacker-controlled and PR #60 explicitly downgraded client signals to telemetry rather than authorization.
- PR #60 already established hard server boundaries for single-use challenge state, persisted device identity and bounded server/client timing; these remain the immediate rejection conditions.
- `award_game_trophies_for_date()` and `get_game_daily_awards()` independently implemented Golden Boot, Golden Glove and Golden Ball ordering. `get_game_player_honours_progress()` had a third current-day implementation.
- `sync_game_trophy_history()` only filled missing dates and could not correct a persisted winner after integrity changes.
- `sync_game_league_trophies()` only inserted a missing champion and could not replace a champion whose winning attempt later became ineligible.
- Trophy and progression achievements were append-only, and featured achievement rows could remain active after the qualifying history became invalid.
- Production snapshot validation assumed verified attempts, trophies and achievements were monotonic, which conflicted with deliberate retrospective fraud correction.

## Decision

1. Preserve `game_attempts` as the raw attempt/evidence record. Add a private `game_attempt_integrity` state per attempt and an append-only integrity event ledger.
2. Keep `game_attempts.verified` as the compatibility projection consumed by existing ranking/profile queries. Its authoritative owner becomes the integrity engine; it may change retrospectively while elapsed time and original telemetry remain unchanged.
3. Classify legacy exclusions into:
   - hard-invalid: every existing failure reason except the two heuristic reasons `repeated_near_perfect_results` and `repeated_interaction_fingerprint`;
   - risk-only legacy signals: those two heuristic reasons, which are eligible for reassessment under the new policy.
4. Do not exclude an attempt because of precision alone. Near-perfect frequency can raise risk, but exclusion requires corroborating strong identity and repeated-interaction evidence. IP correlation is weak evidence and can never independently make an attempt ineligible.
5. Use a versioned deterministic risk policy. Store score, reasons, evidence and evaluation time. `watch` is observable risk but remains ranking-eligible; only `excluded` projects `verified=false`.
6. Reassess a bounded 24-hour cluster when a new near-perfect attempt arrives. A later suspicious pattern may therefore invalidate earlier attempts in the same strong-identity cluster.
7. Provide a full deterministic rebuild entrypoint so a future policy version can recalculate historical integrity from raw attempts without inventing a second scoring implementation.
8. Rebuild derived achievements from current authoritative data instead of only appending. Remove invalid achievements and deactivate featured selections that no longer exist.
9. Reconcile referral completion from the current fifth verified global attempt of the referred account. Use the same `referral-complete:<account>` advisory-lock namespace as normal completion so live completion and retrospective correction cannot race.
10. Create one canonical `game_daily_award_candidates(date)` calculation. All current-day JSON, historical persistence, reconciliation and current profile progress delegate to it.
11. Historical daily trophies are replaceable derived rows. Reconciliation upserts the rightful candidate, removes a category with no eligible candidate, updates its run ledger, and rebuilds achievements for old/new winners.
12. Finished league trophies are also replaceable derived rows. Reconciliation recomputes the eligible winner from current verified attempts and rebuilds achievements for affected players.
13. Existing raw history remains auditable; correction never deletes attempts, challenges or integrity events. The integrity-event ledger grants service role `SELECT`/`INSERT`, not `UPDATE`/`DELETE`.
14. Snapshot deployment guards continue enforcing monotonic raw/source history, while explicitly treating verified/reward projections as recomputable metrics.

## Risk policy v2

The policy evaluates hard-valid near-perfect attempts (`difference_ms <= 5`) in a 24-hour window ending at the anchor attempt.

Signals are deliberately asymmetric:

- **Precision frequency**: informational/risk-only. Repeated excellent results increase score but cannot exclude alone.
- **Strong identity**: same device across multiple nicks/accounts is significant. Same canonical account across multiple nicks contributes, but a single skilled player on one identity is not penalized merely for repetition.
- **Repeated interaction fingerprint**: exact repeated normalized client telemetry contributes only as corroborating evidence; it is never an authorization signal.
- **IP correlation**: capped weak evidence for observability only and never satisfies the strong-identity requirement.

An attempt is excluded only when the aggregate score reaches the exclusion threshold **and** the corroborating requirements are present. Otherwise high precision can at most produce `watch`.

Current policy-v2 exclusion requires all of:

- score at least 65;
- at least four near-perfect attempts in the bounded strong-identity window;
- at least three repeated normalized interaction fingerprints;
- at least three nicks on the same device, or at least four repeated zero-motion/user-activation-gap observations.

## Scope

### Included

- Additive PostgreSQL migrations for integrity state/events, scoring, bounded reassessment and full rebuild.
- Effective `verified` projection synchronization.
- Reversible achievement rebuild and featured-achievement cleanup.
- Referral completion reconciliation with canonical advisory locking.
- Canonical date-based daily award candidates and JSON projection.
- Historical daily trophy reconciliation/reassignment.
- Finished league trophy reconciliation/reassignment.
- Current honours-progress award leaders consuming canonical daily results.
- Production snapshot policy for recomputable derived metrics.
- Real local Supabase regression coverage and static security/SSOT contracts.
- Documentation of the new integrity/reward lifecycle.
- Migration-aware player-radar revision synchronization and full desktop/mobile visual evidence required by the repository contract.

### Excluded

- Claiming browser automation is impossible.
- Treating IP as a person or account identity.
- Deleting raw attempt evidence.
- Manual production data edits, remote migration execution, merge or deployment.
- Reconstructing historical duel outcomes that do not retain sufficient canonical winning-attempt identity; this task prevents new ranking/trophy/achievement drift without inventing historical duel evidence.

## Acceptance

- [x] A player can record multiple near-perfect results on one identity without being excluded solely for skill/precision.
- [x] Multiple players/devices sharing one IP are not excluded solely because of that IP.
- [x] A corroborated cross-nick/device repeated-interaction near-perfect cluster can move earlier and later attempts to `excluded`.
- [x] Hard-invalid attempts remain excluded regardless of risk score.
- [x] Reassessment is deterministic, idempotent and policy-versioned.
- [x] Raw attempt timing/telemetry is never deleted or rewritten by integrity reconciliation.
- [x] `game_attempts.verified` matches effective integrity eligibility after reconciliation.
- [x] Removing qualifying attempts removes dependent precision/activity/trophy achievements and invalid featured selections.
- [x] Referral completion/bonus eligibility follows current verified history and shares the live-completion advisory lock.
- [x] One backend function owns Golden Boot/Glove/Ball candidate ordering for any Madrid date.
- [x] Current provisional awards and persisted historical awards consume the same candidate calculation.
- [x] Retrospective invalidation reassigns each affected daily trophy to the rightful eligible successor, or removes it when no candidate exists.
- [x] Finished-league trophy reconciliation can replace or remove the champion using current verified league attempts.
- [x] Reconciliation repairs historical trophy/achievement state idempotently.
- [x] Production deployment history guards continue protecting raw history while permitting intentional derived-integrity corrections.
- [x] Empty-database migration and real local integration journeys pass.

## Tests and validation

Canonical PR run `31337192721` at head `73c02bc404b78611cb99df4060af8098b65d002c` validated the implementation before this documentation-only closure commit:

- `Build · Prepare workspace`: passed, including package policy, frozen install, config generation, public-media audit and syntax.
- `Tests · Unit & security`: passed, including `tests/security/integrity-reconciliation.test.js`.
- `ESLint`: passed with zero warnings.
- `Knip`: passed.
- `Supabase · security`: passed.
- `Supabase · migrations`: passed from an empty local database.
- `Supabase · gameplay-core`: passed.
- `Supabase · gameplay-sharing`: passed and includes `scripts/test-integrity-reconciliation-local.mjs` after the canonical trophy suite.
- `Supabase · auth-api`: passed.
- `Supabase · auth-browser`: passed.
- `Supabase · ready-flow`: passed, including the real ranked Desktop/Mobile Playwright journey.
- `Authentication Quality`, `CodeQL Advanced` and `Public Asset Audit`: passed.
- `Player Pages and Social Cards` run `31337192745`: passed all 16 browser capture shards, validated 44 platform screens and 13 recorded interaction areas, and published artifact `platform-evidence-31337192745` with digest `sha256:ce61427e5ab1421c4f39c84a442e76d9f896facf5536f12da647f27a3f312e40`.
- `Pull Request Visual Evidence` rerun `31337325629`: passed after binding the PR evidence block to that artifact.

The only failing canonical quality stage on that validated code head is the dependency audit. It is external to this change: the frozen lock currently resolves `brace-expansion@5.0.8` while the advisory requires `>=5.0.9`, and `nanoid@3.3.15` while the advisory requires `>=3.3.17`. Package policy/install themselves pass. On 2026-08-09 the official npm package page still exposes `brace-expansion` 5.0.8 as the published current version, so the audit cannot be made green by weakening policy or inventing an unavailable version. No advisory ignore was added.

Focused integration assertions additionally prove:

- five near-perfect attempts by one skilled identity remain verified;
- six different devices sharing one IP remain verified;
- a four-nick same-device repeated automation-shaped cluster retrospectively excludes its earlier attempts;
- a previously persisted suspicious daily winner loses Golden Boot/Glove/Ball and the eligible fallback player receives them;
- invalidated `first_trophy` and featured state are removed/deactivated while the rightful successor receives the derived achievement;
- repeated reconciliation makes no further verification changes;
- current and explicit-current-date award JSON are identical;
- raw client telemetry remains stored while policy-v2 events are appended.

## Rollback

Do not rewrite or remove an applied migration. Application rollback may stop invoking reassessment while preserving the new audit tables. Any policy correction after deployment must be a forward migration that updates the versioned scoring/reconciliation functions and reruns the deterministic rebuild. Raw attempts and integrity events remain available for audit and recovery.

## Delivery

- Branch: `agent/security-ranked-integrity-reconciliation`
- Base: `main`
- Pull request: `#66`, normal and non-draft.
- Merge, deployment, release and production migration execution are not authorized and were not performed.

## Status

Implemented and validated. All task-owned code, migration, database, browser, static-analysis and visual-evidence checks pass on the validated code head. Delivery is blocked only by newly published transitive dependency advisories whose patched versions are not currently available through the repository's frozen dependency graph; the security gate was not weakened.
