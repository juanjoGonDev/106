# Trophies and achievements

## Integrity is upstream of rewards

`game_attempts` remains the raw competition/evidence history. Ranked eligibility is owned by the versioned integrity engine in `game_attempt_integrity`; `game_attempts.verified` is its compatibility projection for existing ranking/profile queries.

Hard server failures stay ineligible. Statistical or browser-behaviour signals are risk evidence, not proof on their own: precision alone cannot exclude an attempt and an IP address is never treated as a player identity. A later corroborated pattern may reassess earlier attempts in the same bounded device cluster. Every material integrity transition is appended to `game_attempt_integrity_events`; raw elapsed time and telemetry are not deleted.

When effective eligibility changes, the backend reconciles every dependent reward instead of leaving stale state:

- referral completion follows the deterministic fifth currently verified global attempt of the referred account;
- daily trophies are recomputed for the affected Madrid date;
- finished league trophies are recomputed from currently verified league attempts;
- player achievements are rebuilt from current authoritative attempts/trophies/referrals;
- featured achievements that are no longer unlocked are deactivated.

This makes a late fraud decision reversible and auditable. If a policy correction later restores an attempt, the same reconciliation path can restore the rewards implied by the corrected history.

## Daily award single source of truth

Daily awards use the `Europe/Madrid` game day provided by `game_server_day()` / `game_server_reset_at()`.

`game_daily_award_candidates(date)` is the only owner of Golden Boot, Golden Glove and Golden Ball ordering for **any** date. The following flows consume it rather than reimplementing the formulas:

- `get_game_daily_awards_for_date(date)` — canonical JSON projection;
- `get_game_daily_awards()` — current provisional day;
- `reconcile_game_trophies_for_date(date)` / `award_game_trophies_for_date(date)` — closed-day persistence and correction;
- `get_game_player_honours_progress()` — current leader/progress display.

The current day remains provisional and is never persisted as a closed daily trophy. Closed dates are reconciled under an advisory lock. A previously persisted winner may be replaced when integrity changes; if no eligible candidate remains, that category is left unawarded. `game_trophy_award_runs` records the latest policy version used for each closed date so historical backfill is idempotent and policy-aware.

`sync_game_trophy_history()` processes missing or older-policy closed dates. The integrity rebuild also explicitly reconciles every affected closed date, so historical corrections do not wait for a later read.

## Categories

- **Golden Boot:** lowest verified global difference of the day; ties use the earliest best attempt and normalized nickname.
- **Golden Glove:** lowest daily average among players with at least three verified global attempts; ties use best difference, earliest best attempt and normalized nickname.
- **Golden Ball:** most verified global attempts, then best difference, average, earliest best attempt and normalized nickname.

League attempts and currently excluded attempts never participate. Team display is derived from the winner's latest verified attempt on that same award date, keeping historical output stable instead of depending on future games.

## League trophies

`reconcile_game_league_trophy(league_id)` is the canonical correction path for an eligible finished league. It computes the champion from current verified attempts, updates the persisted trophy when the rightful winner changes, or removes the trophy when no eligible attempt remains. All league members then have progression/podium achievements rebuilt because a champion change can shift more than one podium position.

`sync_game_league_trophies()` delegates to that reconciliation function for every finished league and is idempotent when nothing changed.

## Achievements

`game_player_achievements` is derived reward state, not an immutable source event. `rebuild_game_player_achievements(nick_key)` clears and deterministically regenerates all trophy/progression achievement families from current authoritative history, then disables featured selections whose achievement no longer exists.

Current families include trophy totals/categories/streaks/monthly firsts/collections, precision and verified-attempt milestones, referrals, duels and league participation/podiums. This means an integrity correction cannot leave an unearned precision achievement, trophy milestone or featured badge behind.

## Deployment and rollback

Production migrations remain additive and forward-only. The new integrity tables/events add audit state; raw attempts are not removed. Reconciliation functions may intentionally reduce or reassign **derived** values such as verified attempts, completed referrals, trophies, league trophies and achievements.

Production snapshot validation therefore keeps source/history metrics (attempts, players, accounts, referrals, leagues, etc.) monotonic, while logging integrity-dependent reward metrics as recomputable rather than treating a legitimate fraud correction as data loss.

Do not rewrite an applied integrity migration. A future policy change must ship as a forward migration, update the policy version, and use the deterministic rebuild/reconciliation entrypoints. Backup/PITR remains the recovery boundary for raw production history.
