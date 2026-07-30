# Spain daily reset alignment and radar-statistic guidance

## Status

Implementation is complete on `agent/fix-spain-daily-reset-impact` in PR #57. Final-head CI and platform evidence are running. No merge, deployment, release or production migration has been performed.

## Request

- Keep the live reset countdown only in the dedicated daily-limit card; the exhausted message below the nickname must not repeat the exact time.
- Align the global daily-attempt quota with the observed daily challenge reset at 00:00 in mainland Spain instead of the previous UTC boundary.
- Explain how the public-profile `Impacto` statistic grows because the current chart gives no actionable feedback and appears static.
- Replace the single Impacto note with one compact dropdown/accordion per radar statistic, explaining what it measures, its exact calculation and how the player can improve it.

## Evidence

- `exhaustedDailyLimitCopy()` embedded `HH:MM:SS` in `#nickStatus`, while `#dailyLimitCountdown` already presented the same live value in the dedicated card.
- The screenshot captured at 00:11 in Spain showed roughly 01:48 remaining, which corresponded to a 00:00 UTC reset and conflicted with the product reset observed at Spanish midnight.
- `game_server_day()` and `game_server_reset_at()` used UTC, and persisted global challenge/attempt quota days inherited that boundary.
- `Impacto` is `completedReferrals * 20 + bonusAttempts * 8`, capped at 100. A player with zero completed referrals and one authentication-derived daily attempt therefore has only 8/100; ordinary attempts, trophies and achievement points do not change this community-impact metric.
- The radar originally exposed neither numeric scores nor progression inputs. The first correction explained only Impacto, leaving Precisión, Regularidad, Experiencia and Fiabilidad equally opaque.
- The first strict clean-route browser run exposed an existing relative-favicon regression: after `history.replaceState()`, the browser requested `/player/assets/favicon.svg`; the HTML fallback then preloaded `/player/share-actions.js` as JavaScript and raised `Unexpected token '<'`.

## Decisions

1. The nickname status uses stable exhausted copy only: `Has agotado tus N intentos globales de hoy.` The dedicated card remains the single live countdown surface.
2. The canonical server day becomes the IANA timezone `Europe/Madrid`, not a fixed UTC offset, so summer and winter daylight-saving boundaries remain correct.
3. Apply the timezone correction through a new forward migration. Do not rewrite already-applied migrations.
4. Recalculate persisted global `quota_day` values from their authoritative timestamps and update defaults to call the canonical server-day function. League quotas remain unchanged.
5. Keep the established meanings of all five radar statistics. Expose the current score and the exact existing scoring inputs instead of redefining historical profiles.
6. Centralize thresholds and point values in the radar scoring policy so the chart and explanatory copy cannot drift.
7. Render five native `<details>/<summary>` controls. Each collapsed summary shows the current score and input; its expanded content explains `Qué mide`, `Cómo se calcula` and `Cómo mejorar`.
8. Keep controls collapsed by default to limit visual density. Native keyboard and screen-reader semantics are preserved without a custom disclosure state machine.
9. Reuse the existing formula for the web radar and generated social card; no duplicate scoring contract or cross-surface drift is introduced.
10. Cache-bust the changed CSS and player-radar asset so deployed browsers do not retain the previous single-note UI.
11. Resolve public player assets against the shared application base before the clean URL replaces `player.html`; reject regressions that request assets below `/player/`.

## Radar scoring contract

- **Precisión:** `100 - bestDifferenceMs / 1000 * 100`, rounded and clamped to `0..100`.
- **Regularidad:** `100 - averageDifferenceMs / 1500 * 100`, rounded and clamped to `0..100`.
- **Experiencia:** `verifiedAttempts / 20 * 100`, rounded and clamped to `0..100`; one valid attempt contributes five points.
- **Fiabilidad:** `verifiedAttempts / attemptsUsed * 100`, rounded and clamped to `0..100`; zero used attempts produce zero.
- **Impacto:** `completedReferrals * 20 + bonusAttempts * 8`, rounded and clamped to `0..100`.

## Acceptance criteria

1. When a global quota is exhausted, `#nickStatus` contains no clock value and the dedicated card continues updating `HH:MM:SS` once per second.
2. The result panel reuses the same non-duplicated exhausted copy when visible.
3. The next global quota day begins at 00:00 `Europe/Madrid` in both summer and winter.
4. `dailyResetAt` represents the exact corresponding UTC instant: 22:00 UTC during CEST and 23:00 UTC during CET for the tested dates.
5. Existing global challenge and attempt rows are remapped from their timestamps to the Spain server day; league rows are not modified.
6. Database defaults use the canonical server-day helper rather than duplicating timezone expressions.
7. The public profile contains exactly five radar-statistic disclosure controls: Precisión, Regularidad, Experiencia, Fiabilidad and Impacto.
8. Every collapsed summary shows the live score over 100 and the current underlying input.
9. Every expanded control explains what the statistic measures, the shared calculation and the concrete action that improves it.
10. A profile with best difference `4 ms`, average difference `250 ms`, `17/17` valid attempts and one bonus attempt shows scores `100`, `83`, `85`, `100` and `8` respectively.
11. Impacto explicitly states that referrals add 20, daily bonus attempts add 8 and ordinary games, trophies and achievements do not directly increase it.
12. The disclosures work with pointer and keyboard, expose an accessible name, retain visible focus and do not cause horizontal overflow at Mobile widths.
13. Clean player routes do not request `/player/assets/*` or `/player/share-actions.js` after canonical URL replacement.
14. Unit, contract, real local PostgreSQL/Supabase, security, Desktop/Mobile Playwright and full-platform evidence checks remain green.

## Risks

- **Timezone/DST drift:** use PostgreSQL `Europe/Madrid`; never store or calculate a fixed `+01:00`/`+02:00` offset.
- **Current-day remapping:** recalculate only global rows from immutable `started_at`/`created_at` timestamps so the corrected quota cannot be bypassed and historical rows remain preserved.
- **Rolling deployment:** all quota consumers already call the shared helpers; the forward migration changes one canonical boundary without changing response shapes.
- **Metric expectations:** retain established radar semantics and expose formulas instead of silently changing existing scores.
- **Formula/copy drift:** thresholds and Impacto point values live in one `RADAR_POLICY` consumed by both scoring and explanation generation.
- **Disclosure accessibility:** prefer native details/summary semantics; verify Enter interaction, focus state and full Mobile layout in Playwright.
- **Browser cache:** version the changed CSS and player-radar entry point while keeping source files and public contracts canonical.
- **Clean-route assets:** normalize the favicon before URL replacement and keep a browser regression assertion for leaked `/player/` asset paths.

## Validation plan

- Unit tests for exhausted copy, all five radar scores, all five explanation models, singular/plural Impacto copy, malformed values and empty reliability.
- Contract tests for the five native disclosure controls, accessible labels, focus styling, cache-busted assets and removal of the previous single Impacto target.
- Migration contracts for `Europe/Madrid`, canonical defaults, global-only remapping and forward-only delivery.
- Real local PostgreSQL assertions across summer and winter midnight boundaries and the exact `dailyResetAt` instant.
- Desktop and Mobile Playwright for the daily-limit card, five statistic disclosures, keyboard opening/closing, Impacto guidance, responsive overflow and clean-route asset resolution.
- `pnpm check`, local Supabase suites, security checks and the complete platform evidence workflow on the final pull-request head.

## Rollback

Revert the frontend changes normally. If the timezone migration has reached production, add a new forward migration restoring the previous server-day policy and remapping affected global rows from their authoritative timestamps. Never rewrite or delete an applied migration.

## Delivery

- Branch: `agent/fix-spain-daily-reset-impact`
- Base: `main`
- Pull request: #57, normal and non-draft
- No merge, deployment, release or remote migration without explicit authorization
