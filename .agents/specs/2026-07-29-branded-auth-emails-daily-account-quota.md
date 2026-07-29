# Branded authentication emails and daily account quota projection

## Status

Implementation in progress on one task branch. Delivery requires final-head quality, Supabase integration and visual-evidence workflows to pass before review. No production migration, hosted Auth configuration, deployment or merge is authorized by this task.

## Request

- Replace the plain Supabase authentication email with a branded Minuto 106 experience using the product imagery, typography hierarchy, colors, clear calls to action and the available one-time code.
- Centralize the layout and inline email styles so every authentication and security email uses the same maintained design rather than duplicating markup.
- Fix the account page reporting `0 intentos disponibles` for linked nicknames that still have capacity under the current server-day quota.

## Evidence

- The hosted confirmation email currently renders Supabase's default English body instead of the repository template.
- `supabase/config.toml` only configures the confirmation template, while Supabase supports confirmation, recovery, magic-link, invite, email-change, reauthentication and security-notification templates.
- Hosted Supabase email templates are operational project configuration. Repository `config.toml` and HTML files configure the local stack and provide deployable source, but they do not update the hosted project automatically.
- `20260727150500_daily_profile_limits.sql` correctly projected `get_game_daily_attempt_state()` over linked players when it was introduced.
- A later account-linking migration redefined `get_game_account_players(text)` with a lifetime formula: base five plus legacy bonus minus every historical attempt.
- Existing production environments can therefore have the later definition even though a clean rebuild applies migration filenames in an order that leaves the daily wrapper last. This out-of-order upgrade drift explains why nicknames with more than five historical attempts render zero despite a fresh daily allowance.

## Decision

1. Maintain one data-driven email catalogue and one renderer in `scripts/auth-email-templates.mjs`.
2. Commit generated standalone HTML because email clients require inline styles and Supabase consumes one complete template per flow.
3. Cover every supported authentication flow and every security notification with the same table-based, responsive layout, absolute public image URL, text fallback, security copy and product colors.
4. Show the OTP prominently only where it is directly useful: signup confirmation, magic-link/OTP and reauthentication. Preserve the custom confirmation link based on `RedirectTo`, `TokenHash` and `type=email` because the application verifies that contract.
5. Provide deterministic generation, a stale-template CI check and an exported Management API payload. Never embed an access token or project secret.
6. Keep hosted template activation explicit and documented. The pull request must not mutate hosted Auth configuration.
7. Add one forward-only migration newer than every current migration. It must redefine `get_game_account_players(text)` directly instead of relying on rename chains whose result depends on deployment history.
8. Preserve lifetime profile metrics (`attemptsUsed`, verified attempts, best, average and latest team), then merge the authoritative current-day state on the right so `attemptsLeft`, reservations, bonuses, maximum and reset timestamp always come from `get_game_daily_attempt_state()`.
9. Keep the function `SECURITY DEFINER`, use the canonical account resolver and retain service-role-only execution.
10. Prove the reported regression with more than six historical attempts from a previous UTC day and verify that the account projection still returns the full current-day allowance.

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

## Validation plan

- Generated-template equality and catalogue contract tests.
- 100% line, function and branch coverage for the isolated email renderer.
- Vitest migration contract proving the forward correction and privilege boundary.
- Real local PostgreSQL regression with seven previous-day attempts, current-day exhaustion and account API projection assertions.
- Empty database rebuild and incremental migration suite.
- Existing complete `pnpm check`, Supabase domain suites and browser/evidence workflows.

## Risks

- **Hosted default remains visible after merge:** expected until the maintained payload is applied in Supabase Dashboard or Management API. Documentation and PR delivery must state this explicitly.
- **Email-client rendering differences:** use nested presentation tables, inline styles, fixed image dimensions, meaningful alt text and useful text when remote images are blocked.
- **Link prefetching:** confirmation keeps the repository's custom token-hash route rather than replacing it with an unreviewed direct flow.
- **Migration-order drift:** the correction is a new final definition and does not rename or depend on an earlier function alias.
- **Metric ambiguity:** lifetime `attemptsUsed` remains a historical metric; daily fields are explicitly merged from the server-day helper.

## Rollback

- Before deployment, revert the branch.
- After applying the database migration, restore behavior with a new forward migration; never edit or delete an applied migration.
- Hosted templates can be restored independently from the Supabase dashboard using the previously exported configuration.
- Generated email sources are passive until local startup or explicit hosted synchronization consumes them.

## Delivery

- Branch: `agent/fix-branded-auth-emails-daily-account-quota`
- Base: `main`
- One normal, non-draft pull request.
- No merge, deploy, hosted Auth update or production migration without explicit approval.
