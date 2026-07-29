# Hosted Auth email deployment, complete sign-out and reusable password update

## Status

Implementation complete on one task branch. Delivery is accepted only when the final branch head has green quality, authentication, Supabase, browser and visual-evidence checks and PR #53 links the final-head platform artifact. No merge, production deployment or manual hosted configuration mutation is included.

## Request

- Stop production Supabase Auth from continuing to send the old hosted email after repository templates are merged.
- Always expose an account sign-out action for an authenticated email session, including accounts with zero linked nicks.
- Make sign-out complete on the current browser so the user can immediately open login and registration again without clearing cookies, storage or cache manually.
- Keep password recovery available from login with explicit wording.
- Let an authenticated email user change their password from Mi cuenta.
- Reuse one dedicated password page for both an authenticated password change and a recovery-link reset.

## Evidence

- PR #52 generated and tested the branded email catalogue but intentionally left hosted activation as a manual post-merge operation.
- The production deployment workflow already has the protected `production` environment, `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_ID`, but did not PATCH or verify hosted Auth `mailer_*` configuration.
- Supabase hosted projects send Auth emails from project-level configuration; `supabase/config.toml` and repository HTML configure local development and provide deployable source, but they do not update the hosted project automatically.
- Since 3 June 2026, newly created Free projects using Supabase default SMTP cannot customize Auth templates. Paid projects and Free projects with custom SMTP remain eligible. The observed Brevo sender suggests custom SMTP, but deployment must report an exact API rejection rather than silently claiming success.
- `cuenta.html` contained a cloud sign-out button, but the operation cleared only the Supabase session and explicitly left the local account key active.
- Auth route guards treated a local account token, remembered account nick or legacy local nick as an active account. Consequently cloud-only sign-out could still redirect login and registration back to Mi cuenta.
- `restablecer-clave.html` already updated an authenticated Supabase session, but its copy and controller modeled only recovery-link usage and it was not reachable from the authenticated account panel.
- Login already sent a recovery request, but the action label was not explicit enough to read as the conventional forgotten-password path.

## Decisions

1. Extend the existing protected Supabase production workflow rather than adding an independent privileged workflow.
2. Synchronize the complete generated hosted Auth payload through the Supabase Management API on every relevant production Supabase deployment. Read current configuration first, PATCH only when managed keys drift, then fetch again and fail unless every managed value matches exactly.
3. Never print the access token or full HTML payload in logs. Report only managed key names, HTTP status and a bounded API error body.
4. Treat hosted template synchronization failure as a deployment failure. Explain likely Free/default-SMTP restrictions when the Management API rejects customization, while retaining a bounded original response for diagnosis.
5. Keep synchronization logic dependency-free, testable through injected `fetch`, and covered at 100% lines/functions/branches.
6. Replace cloud-only sign-out semantics with an explicit complete browser sign-out after confirmation: revoke the Supabase session when reachable and always clear Supabase session/PKCE state, pending confirmation state, account token, remembered account nicks, legacy local player credentials and selected nick.
7. Remote logout failure must not trap the user in the local session. The browser clears all local credentials and reports that remote revocation could not be confirmed.
8. Preserve the separate private-key card action, but make its wording clear that it removes only the local private-key session.
9. Render complete sign-out solely from authenticated state; linked-player count and the account-player request do not gate it.
10. Add password management only when the authenticated identity includes the `email` provider. Google-only users do not have a password-management action and direct change-mode navigation returns to Mi cuenta.
11. Reuse `restablecer-clave.html` as a dual-purpose password page. An explicit authenticated `mode=change` enters change mode; a recovery callback enters recovery mode.
12. In change mode require the current password plus a valid, exactly confirmed new password. In recovery mode require only the valid, exactly confirmed new password.
13. Extend the direct Supabase Auth client update request with optional `current_password`; do not duplicate password policy or visibility controls.
14. Preserve the valid session after a successful update and expose a clear return to Mi cuenta. Recovery and authenticated change use mode-specific title, lead, labels, autocomplete and success copy.
15. Keep guest-only login/register guards. Complete sign-out removes every local state input that those guards consider authenticated.
16. Preserve the existing `signOut()` contract for callers: it clears local Auth state in `finally`, rethrows remote failures by default and supports an explicit local-first option for the account UX to report remote revocation status.

## Acceptance criteria

1. Production Supabase deployment computes the generated hosted Auth payload, detects managed-key drift, applies it with the protected Management API token and verifies exact post-PATCH equality.
2. A no-drift deployment performs no PATCH.
3. Missing credentials, GET failure, PATCH failure and persistent post-PATCH drift fail with actionable output and no secret or HTML disclosure.
4. Template source/config/generator changes trigger the production Supabase workflow.
5. An authenticated email account with zero players shows `Cambiar contraseña` and `Cerrar sesión`.
6. Google-only authenticated accounts show complete sign-out but not password change, including direct-route protection.
7. Complete sign-out calls Supabase logout once when a session exists and clears Supabase session, PKCE/return state, pending email confirmation, account token, remembered account nicks, legacy local credentials and selected nick even when remote logout fails.
8. After complete sign-out, Mi cuenta renders guest actions and both `login.html` and `registro.html` remain accessible without manual browser cleanup.
9. A subsequent email login succeeds in the same browser session.
10. Login exposes an explicit forgotten-password action and sends exactly one neutral recovery request for a valid email.
11. An authenticated email user reaches the reusable password page from Mi cuenta, sees change-password copy and must provide the current password.
12. A recovery callback reaches the same page with reset-password copy and does not request the current password.
13. Both modes enforce the shared password policy, exact confirmation and password visibility component.
14. The authenticated update sends `current_password`; recovery sends only the new password.
15. Desktop and Mobile Playwright journeys prove zero-player sign-out, re-login, register-route access, authenticated password change, recovery reset, provider-only route rejection, keyboard-accessible controls, no unexpected page/console/network failures and no horizontal overflow.
16. The final branch produces the required platform evidence artifact and embeds a complete Desktop/Mobile/GIF account-authentication area in the PR, with password reset Desktop/Mobile captures retained in the artifact.

## Implementation

### Hosted email configuration

- `scripts/hosted-auth-email-sync.mjs` owns environment validation, drift calculation, bounded Management API requests, apply/check behavior and exact verification.
- `scripts/sync-hosted-auth-email-templates.mjs` is the operational CLI.
- `.github/workflows/supabase.yml` runs synchronization inside the existing protected `production` environment before database or Edge Function mutation.
- `tests/hosted-auth-email-sync.node-test.js` and `tests/hosted-auth-email-deployment.test.js` cover logic and workflow boundaries.
- `docs/auth-email-templates.md` documents automatic rollout, operator checks, SMTP restrictions, real-client smoke tests and rollback.

### Session boundary

- `public/supabase-auth-client.js` clears Supabase session, PKCE and return state in all logout outcomes while preserving the default API contract.
- `public/access.js` exposes one complete local account-session cleanup operation.
- `public/account-auth.js` confirms destructive browser cleanup, requests local-first logout status, clears pending confirmation and local credentials, refreshes to guest state and reports remote revocation failure.
- `public/auth-experience-state.js` no longer treats remembered display names as credentials and identifies email-password capability independently of linked players.

### Password flow

- `public/password-page-state.js` centralizes mode, copy and validation decisions.
- `public/restablecer-clave.html` and `public/password-reset.js` implement one page for explicit authenticated change and recovery callback reset.
- `public/cuenta.html` exposes password change only to email-capable identities.
- `public/login.html` labels the recovery action explicitly.
- The existing shared password policy and visibility component remain authoritative.

## Validation

- Isolated hosted email synchronization and password-mode decisions enforce 100% line/function/branch coverage.
- Supabase Auth client tests cover current-password payloads, default remote-error propagation, local cleanup and explicit local-first logout reporting.
- Route/component contracts cover account-controller ownership of pending cleanup and shared password controls.
- Playwright covers zero-player account logout, complete storage cleanup, registration and re-login without browser reset, remote logout failure, authenticated password change, recovery reset, provider-only rejection, keyboard visibility controls and responsive overflow.
- Existing unit, security, ESLint, Knip, public-asset, Supabase domain and full-platform evidence suites remain authoritative.
- The final PR body records the exact successful workflow runs, final commit, platform artifact URL, digest and changed-area evidence.

## Risks

- **Free/default SMTP restriction:** hosted PATCH may be rejected for a newly created Free project without custom SMTP. Deployment fails with the Supabase response and remediation instead of leaving stale templates unnoticed.
- **Template parser fallback:** a syntactically accepted configuration can still fail at send time. Hosted Auth logs and real email smoke messages remain required after deployment.
- **Logout data loss:** complete sign-out intentionally removes local private credentials. The UI requires explicit confirmation and explains that recoverable cloud login is needed to regain linked progress.
- **Remote revocation outage:** local credentials are still cleared. The UI warns that server revocation could not be confirmed and recommends changing the password if the session may be compromised.
- **Current-password project setting:** sending `current_password` supports stricter hosted configuration without weakening projects where it is optional.
- **Recovery callback ambiguity:** explicit change mode is separated from recovery callback provenance and covered for existing-session, callback-created-session, provider-only and invalid-session paths.

## Rollback

- Revert the branch before merge.
- After merge, restore the previous workflow/script with a normal revert; do not expose or rotate secrets in source.
- Hosted Auth configuration can be restored from the pre-sync `mailer_*` export through the Management API or Dashboard.
- Password/session changes are client-only and can be reverted without a database migration.

## Delivery

- Branch: `agent/fix-auth-session-password-emails`
- Base: `main` at `a278b85588cfa908d532a6a211e57fdc47ef2900`.
- Pull request: `#53`.
- One normal, non-draft pull request.
- No temporary/evidence branch, rebase, force-push, merge, production deployment or hosted Auth mutation from this task.