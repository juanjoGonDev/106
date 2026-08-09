# Ranked integrity reconciliation and reward correction

## Request

Replace brittle one-rule anti-cheat exclusions with a centralized, retrospective integrity assessment that combines independent server-observable risk signals without treating excellent timing or a shared IP as proof of cheating. When later evidence makes an attempt ineligible, recompute every dependent competitive result: global ranking eligibility, daily trophies, league trophies, trophy/precision/activity achievements and featured-achievement validity. Reassign a trophy to the player who should have won that date or league when an eligible successor exists; otherwise leave the category unawarded.

Centralize daily award calculation for any Madrid calendar date so current provisional awards, historical persistence, reconciliation and profile progress all consume one canonical backend calculation.

## Evidence

- The current canonical `finish_game_attempt` marks the third result within 5 ms during 24 hours as unverified when either the device hash or IP hash matches. This treats a weak shared-network identifier like a strong identity and uses precision alone as a decisive rule.
- The same function excludes an exact repeated interaction fingerprint immediately after two prior matches, even though browser telemetry is attacker-controlled and PR #60 explicitly downgraded client signals to telemetry rather than authorization.
- PR #60 already established hard server boundaries for single-use challenge state, persisted device identity and bounded server/client timing; these are suitable immediate rejection conditions.
- `award_game_trophies_for_date()` and `get_game_daily_awards()` independently implement Golden Boot, Golden Glove and Golden Ball ordering. `get_game_player_honours_progress()` has a third current-day implementation.
- `sync_game_trophy_history()` only fills missing dates. It cannot correct a previously persisted winner after integrity changes.
- `sync_game_league_trophies()` only inserts a missing champion. It cannot replace a champion whose winning attempt later becomes ineligible.
- Trophy and progression achievements are append-only. An achievement remains stored after the qualifying attempts or trophies are invalidated.
- Featured achievement rows can remain active after their underlying achievement disappears.
- Production snapshot validation currently assumes verified attempts, trophies and achievements are monotonic, which conflicts with deliberate retrospective fraud correction.

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
9. Reconcile referral completion from the current fifth verified global attempt of the referred account so retroactive invalidation cannot retain an unearned referral reward.
10. Create one canonical `game_daily_award_candidates(date)` calculation. All current-day JSON, historical persistence, reconciliation and current profile progress delegate to it.
11. Historical daily trophies are replaceable derived rows. Reconciliation upserts the rightful candidate, removes a category with no eligible candidate, updates its run ledger, and rebuilds achievements for old/new winners.
12. Finished league trophies are also replaceable derived rows. Reconciliation recomputes the eligible winner from current verified attempts and rebuilds achievements for affected players.
13. Existing raw history remains auditable; correction never deletes attempts, challenges or integrity events.
14. Snapshot deployment guards continue enforcing monotonic raw/source history, while explicitly treating verified/reward projections as recomputable metrics.

## Risk policy v2

The policy evaluates hard-valid near-perfect attempts (`difference_ms <= 5`) in a 24-hour window ending at the anchor attempt.

Signals are deliberately asymmetric:

- **Precision frequency**: informational/risk-only. Repeated excellent results increase score but cannot exclude alone.
- **Strong identity**: same device across multiple nicks/accounts is significant. Same canonical account across multiple nicks contributes, but a single skilled player on one identity is not penalized merely for repetition.
- **Repeated interaction fingerprint**: exact repeated normalized client telemetry contributes only as corroborating evidence; it is never an authorization signal.
- **IP correlation**: capped weak evidence for observability only and never satisfies the strong-identity requirement.

An attempt is excluded only when the aggregate score reaches the exclusion threshold **and** both a strong-identity condition and repeated-interaction condition are present. Otherwise high precision can at most produce `watch`.

## Scope

### Included

- Additive PostgreSQL migration for integrity state/events, scoring, bounded reassessment and full rebuild.
- Effective `verified` projection synchronization.
- Reversible achievement rebuild and featured-achievement cleanup.
- Referral completion reconciliation.
- Canonical date-based daily award candidates and JSON projection.
- Historical daily trophy reconciliation/reassignment.
- Finished league trophy reconciliation/reassignment.
- Current honours-progress award leaders consuming canonical daily results.
- Production snapshot policy for recomputable derived metrics.
- Real local Supabase regression coverage and static security/SSOT contracts.
- Documentation of the new integrity/reward lifecycle.

### Excluded

- Claiming browser automation is impossible.
- Treating IP as a person or account identity.
- Deleting raw attempt evidence.
- Manual production data edits, remote migration execution, merge or deployment.
- Reconstructing historical duel outcomes that do not retain sufficient canonical winning-attempt identity; this task prevents new ranking/trophy/achievement drift without inventing historical duel evidence.

## Acceptance

- [ ] A player can record multiple near-perfect results on one identity without being excluded solely for skill/precision.
- [ ] Multiple players/devices sharing one IP are not excluded solely because of that IP.
- [ ] A corroborated cross-nick/device repeated-interaction near-perfect cluster can move earlier and later attempts to `excluded`.
- [ ] Hard-invalid attempts remain excluded regardless of risk score.
- [ ] Reassessment is deterministic, idempotent and policy-versioned.
- [ ] Raw attempt timing/telemetry is never deleted or rewritten by integrity reconciliation.
- [ ] `game_attempts.verified` always matches effective integrity eligibility after reconciliation.
- [ ] Removing qualifying attempts removes dependent precision/activity/trophy achievements and invalid featured selections.
- [ ] Referral completion/bonus eligibility follows current verified history.
- [ ] One backend function owns Golden Boot/Glove/Ball candidate ordering for any Madrid date.
- [ ] Current provisional awards and persisted historical awards produce the same winner/metrics for the same unchanged date data.
- [ ] Retrospective invalidation reassigns each affected daily trophy to the rightful eligible successor, or removes it when none exists.
- [ ] Retrospective invalidation reassigns an affected finished-league trophy similarly.
- [ ] Reconciliation repairs historical trophy/achievement state idempotently.
- [ ] Production deployment history guards continue protecting raw history while permitting intentional derived-integrity corrections.
- [ ] Empty-database migration and real local integration journeys pass.

## Tests

- Static contract tests for one daily-award SSOT, risk-policy invariants, private integrity tables/functions and forward migration ownership.
- Local PostgreSQL fixture: repeated near-perfect skill on a single identity remains eligible.
- Local PostgreSQL fixture: same-IP/different-device players remain eligible.
- Local PostgreSQL fixture: cross-nick same-device + repeated fingerprint produces a retrospective exclusion cluster.
- Local PostgreSQL fixture: repeated integrity reassessment has no further state changes.
- Daily award fixture: invalidate prior winner, reconcile date, assert successor owns the trophy and old/new achievements are rebuilt.
- No-successor daily award fixture: category is removed safely.
- Finished league fixture: invalidate champion, reconcile, assert next eligible attempt becomes champion.
- Featured achievement fixture: invalidated achievement is deactivated.
- Referral fixture: fifth verified attempt removal reopens completion; restoration uses the deterministic fifth-attempt timestamp.
- Current-day award JSON compared with the canonical date calculation.
- Existing trophy, progression, security, migration and Supabase integration suites remain green.

## Rollback

Do not rewrite or remove the applied migration. Application rollback may stop invoking reassessment while preserving the new audit tables. Any policy correction after deployment must be a forward migration that updates the versioned scoring/reconciliation functions and reruns the deterministic rebuild. Raw attempts and integrity events remain available for audit and recovery.

## Delivery

- Branch: `agent/security-ranked-integrity-reconciliation`
- Base: `main`
- Pull request: normal, non-draft.
- Merge, deployment, release and production migration execution are not authorized.

## Status

In progress. Reconnaissance completed against the current `main` anti-cheat, trophy, achievement, league and deployment-snapshot contracts. Implementation and validation pending.
