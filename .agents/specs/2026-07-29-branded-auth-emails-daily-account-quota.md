# Branded authentication emails and daily account quota projection

## Status

Implementation complete on one task branch and delivered in PR #52. The implementation head passed the quality, authentication, public-asset, social-card and visual-evidence workflows before this closeout update. The documentation-only final head must retain the same green checks before review. No production migration, hosted Auth configuration, deployment or merge is authorized by this task.

## Request

- Replace the plain Supabase authentication email with a branded Minuto 106 experience using the product imagery, typography hierarchy, colors, clear calls to action and the available one-time code.
- Centralize the layout and inline email styles so every authentication and security email uses the same maintained design rather than duplicating markup.
- Fix the account page reporting `0 intentos disponibles` for linked nicknames that still have capacity under the current server-day quota.

## Evidence

- The hosted confirmation email currently renders Supabase's default English body instead of the repository template.
- `supabase/config.toml` only configured the confirmation template, while Supabase supports confirmation, recovery, magic-link, invite, email-change, reauthentication and security-notification templates.
- Hosted Supabase email templates are operational project configuration. Repository `config.toml` and HTML files configure the local stack and provide deployable source, but they do not update the hosted project automatically.
- `20260727150500_daily_profile_limits.sql` correctly projected `get_game_daily_attempt_state()` over linked players when it was introduced.
- A later account-linking migration redefined `get_game_account_players(text)` with a lifetime formula: base five plus legacy bonus minus every historical attempt.
- Existing production environments can therefore have the later definition even though a clean rebuild applies migration filenames in an order that leaves the daily wrapper last. This out-of-order upgrade drift explains why nicknames with more than five historical attempts render zero despite a fresh daily allowance.
- Supabase CLI 2.101.0 resolves authentication template paths from the repository invocation boundary and notification paths from the Supabase configuration directory. The tested local mapping therefore intentionally uses `./supabase/templates/...` for authentication messages and `./templates/notifications/...` for security notifications.

## Decision

1. Maintain one data-driven email catalogue and one renderer in `scripts/auth-email-templates.mjs`.
2. Commit generated standalone HTML because email clients require inline styles and Supabase consumes one complete template per flow.
3. Cover every supported authentication flow and every security notification with the same table-based, responsive layout, absolute public image URL, text fallback, security copy and product colors.
4. Show the OTP prominently only where it is directly useful: signup confirmation, magic-link/OTP and reauthentication. Preserve the custom confirmation link based on `RedirectTo`, `TokenHash` and `type=email` because the application verifies that contract.
5. Provide deterministic generation, a stale-template CI check and an exported Management API payload. Never embed an access token or project secret.
6. Keep hosted template activation explicit and documented. The pull request must not mutate hosted Auth configuration.
7. Add one forward-only migration newer than every current migration. It directly redefines `get_game_account_players(text)` instead of relying on rename chains whose result depends on deployment history.
8. Preserve lifetime profile metrics as `lifetimeAttemptsUsed`, verified attempts, best, average and latest team, then merge the authoritative current-day state on the right so `attemptsUsed`, `attemptsLeft`, reservations, bonuses, maximum and reset timestamp always come from `get_game_daily_attempt_state()`.
9. Keep the function `SECURITY DEFINER`, use the canonical account resolver and retain service-role-only execution.
10. Prove the reported regression with more than six historical attempts from a previous UTC day and verify that the account projection still returns the full current-day allowance.
11. Treat Auth email HTML as an external email-client surface, not a browser route. Keep browser visual evidence strict for browser files while requiring deterministic template tests, local Supabase loading and real hosted Gmail/mobile/non-Gmail smoke checks after explicit activation approval.

## Acceptance criteria

1. All maintained Auth email templates use one branded layout with the Minuto 106 social image, dark surface, gold accent, accessible headings, preheader and plain-link fallback.
2. Signup confirmation includes both a visible OTP and the one-use verification button.
3. Recovery, invite, email change, magic link and reauthentication use flow-appropriate copy and supported Supabase placeholders.
4. Password, email, phone, identity and MFA security notifications share the same layout and contain the relevant event variables.
5. Generated templates exactly match the renderer; CI fails when a generated file or `config.toml` mapping becomes stale.
6. A generated hosted configuration payload contains every subject, HTML body and notification enable flag without credentials.
7. Documentation states the exact hosted rollout boundary and fallback troubleshooting path.
8. A nickname with seven or more historical attempts from a previous server day reports the full current-day quota when no current-day attempts exist.
9. Five current-day attempts report zero remaining for an unbonused nickname, while lifetime totals remain available separately.
10. Account-wide referral and authentication bonuses still propagate to every linked nickname and the absolute daily ceiling remains ten.
11. Anonymous and authenticated browser roles cannot execute the account projection or daily helper directly.
12. Clean rebuild and incremental production-shaped upgrade produce the same final account projection.
13. Existing gameplay, league limits, account linking and profile metrics remain compatible.

## Validation

- Generated-template equality and catalogue contracts pass for all 13 templates.
- The isolated email renderer passes 100% line, function and branch coverage.
- Vitest proves the forward migration ordering, daily overlay and privilege boundary.
- The real local PostgreSQL regression proves seven previous-day attempts produce `lifetimeAttemptsUsed = 7`, `attemptsUsed = 0` and `attemptsLeft = 5`; after five current-day attempts it produces lifetime 12, daily 5 and remaining 0.
- Local Supabase loads the complete authentication and notification catalogue with the pinned CLI.
- Empty database, production-shaped migration, security, gameplay, authentication and browser suites pass in the quality pipeline.
- Implementation-head workflow runs:
  - Pull Request Quality Pipeline #1149: success.
  - Authentication Quality #330: success.
  - Public Asset Audit #822: success.
  - Player Pages and Social Cards #881: success.
  - Pull Request Visual Evidence #897: success.

## Risks

- **Hosted default remains visible after merge:** expected until the maintained payload is applied in Supabase Dashboard or Management API. Documentation and PR delivery state this explicitly.
- **Email-client rendering differences:** nested presentation tables, inline styles, fixed image dimensions, meaningful alt text and useful text when remote images are blocked reduce but do not eliminate client variation. Real hosted-client smoke checks remain mandatory.
- **Link prefetching:** confirmation keeps the repository's custom token-hash route rather than replacing it with an unreviewed direct flow.
- **Migration-order drift:** the correction is a new final definition and does not rename or depend on an earlier function alias.
- **Metric ambiguity:** lifetime totals use `lifetimeAttemptsUsed`; daily `attemptsUsed` and quota fields are explicitly merged from the server-day helper.

## Rollback

- Before deployment, revert the branch.
- After applying the database migration, restore behavior with a new forward migration; never edit or delete an applied migration.
- Hosted templates can be restored independently from the Supabase dashboard or Management API using the previously exported configuration.
- Generated email sources are passive until local startup or explicit hosted synchronization consumes them.

## Delivery

- Branch: `agent/fix-branded-auth-emails-daily-account-quota`
- Base: `main`
- Pull request: #52, normal and non-draft.
- No merge, deploy, hosted Auth update or production migration without explicit approval.
- Remaining operational work after approval: apply the hosted Auth payload, execute real confirmation/recovery/security email smoke checks and apply the production database migration through the normal deployment process.
