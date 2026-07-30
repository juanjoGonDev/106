# Spain daily reset alignment and impact guidance

## Status

Implementation is complete on `agent/fix-spain-daily-reset-impact` in PR #57. Final-head CI, platform evidence packaging and the PR evidence contract are in progress. No merge, deployment, release or production migration has been performed.

## Request

- Keep the live reset countdown only in the dedicated daily-limit card; the exhausted message below the nickname must not repeat the exact time.
- Align the global daily-attempt quota with the observed daily challenge reset at 00:00 in mainland Spain instead of the previous UTC boundary.
- Explain how the public-profile `Impacto` statistic grows because the current chart gives no actionable feedback and appears static.

## Evidence

- `exhaustedDailyLimitCopy()` embedded `HH:MM:SS` in `#nickStatus`, while `#dailyLimitCountdown` already presented the same live value in the dedicated card.
- The screenshot captured at 00:11 in Spain showed roughly 01:48 remaining, which corresponded to a 00:00 UTC reset and conflicted with the product reset observed at Spanish midnight.
- `game_server_day()` and `game_server_reset_at()` used UTC, and persisted global challenge/attempt quota days inherited that boundary.
- `Impacto` is `completedReferrals * 20 + bonusAttempts * 8`, capped at 100. A player with zero completed referrals and one authentication-derived daily attempt therefore has only 8/100; ordinary attempts, trophies and achievement points do not change this community-impact metric.
- The radar exposed neither the numeric score nor the inputs, so the behavior was technically consistent but not understandable.
- The first strict clean-route browser run exposed an existing relative-favicon regression: after `history.replaceState()`, the browser requested `/player/assets/favicon.svg`; the HTML fallback then preloaded `/player/share-actions.js` as JavaScript and raised `Unexpected token '<'`.

## Decisions

1. The nickname status uses stable exhausted copy only: `Has agotado tus N intentos globales de hoy.` The dedicated card remains the single live countdown surface.
2. The canonical server day becomes the IANA timezone `Europe/Madrid`, not a fixed UTC offset, so summer and winter daylight-saving boundaries remain correct.
3. Apply the timezone correction through a new forward migration. Do not rewrite already-applied migrations.
4. Recalculate persisted global `quota_day` values from their authoritative timestamps and update defaults to call the canonical server-day function. League quotas remain unchanged.
5. Keep the existing meaning of `Impacto` as community influence rather than silently redefining historical profile scores. Add a visible score and exact progression explanation below the radar.
6. Reuse the existing formula for the web radar and generated social card; no duplicate scoring contract or cross-surface drift is introduced.
7. Cache-bust the changed daily-attempt module chain, player UI and player radar assets so deployed browsers do not retain stale behavior.
8. Resolve public player assets against the shared application base before the clean URL replaces `player.html`; reject regressions that request assets below `/player/`.

## Acceptance criteria

1. When a global quota is exhausted, `#nickStatus` contains no clock value and the dedicated card continues updating `HH:MM:SS` once per second.
2. The result panel reuses the same non-duplicated exhausted copy when visible.
3. The next global quota day begins at 00:00 `Europe/Madrid` in both summer and winter.
4. `dailyResetAt` represents the exact corresponding UTC instant: 22:00 UTC during CEST and 23:00 UTC during CET for the tested dates.
5. Existing global challenge and attempt rows are remapped from their timestamps to the Spain server day; league rows are not modified.
6. Database defaults use the canonical server-day helper rather than duplicating timezone expressions.
7. The public profile displays the current numeric impact score and states that each completed referral contributes 20 points and each additional daily attempt contributes 8, capped at 100.
8. A profile with zero completed referrals and one bonus attempt visibly reports `Impacto 8/100` and the next action required.
9. Desktop and Mobile browser journeys verify the non-duplicated countdown copy, impact guidance, accessibility, no horizontal overflow, and no page, console or request failures.
10. Clean player routes do not request `/player/assets/*` or `/player/share-actions.js` after canonical URL replacement.
11. Unit, migration-contract, real local PostgreSQL/Supabase, strict coverage, security and full-platform evidence checks remain green.

## Risks

- **Timezone/DST drift:** use PostgreSQL `Europe/Madrid`; never store or calculate a fixed `+01:00`/`+02:00` offset.
- **Current-day remapping:** recalculate only global rows from immutable `started_at`/`created_at` timestamps so the corrected quota cannot be bypassed and historical rows remain preserved.
- **Rolling deployment:** all quota consumers already call the shared helpers; the forward migration changes one canonical boundary without changing response shapes.
- **Metric expectations:** retain the established community-impact semantics and expose the formula instead of changing existing scores without a product migration.
- **Browser cache:** version the changed entry modules while keeping source files and public contracts canonical.
- **Clean-route assets:** normalize the favicon before URL replacement and keep a browser regression assertion for leaked `/player/` asset paths.

## Validation plan

- Unit tests for exhausted copy and impact explanation, including singular/plural and the reported `8/100` state.
- Migration contracts for `Europe/Madrid`, canonical defaults, global-only remapping and forward-only delivery.
- Real local PostgreSQL assertions across summer and winter midnight boundaries and the exact `dailyResetAt` instant.
- Desktop and Mobile Playwright for the daily-limit card, public player radar explanation and clean-route asset resolution.
- `pnpm check`, local Supabase suites, security checks and the complete platform evidence workflow on the final pull-request head.

## Rollback

Revert the frontend changes normally. If the timezone migration has reached production, add a new forward migration restoring the previous server-day policy and remapping affected global rows from their authoritative timestamps. Never rewrite or delete an applied migration.

## Delivery

- Branch: `agent/fix-spain-daily-reset-impact`
- Base: `main`
- Pull request: #57, normal and non-draft
- No merge, deployment, release or remote migration without explicit authorization
