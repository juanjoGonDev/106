# Hosted Auth email deployment, complete sign-out and reusable password update

## Status

Implementation in progress on one task branch. Delivery requires final-head quality, authentication, Supabase deployment-contract and Desktop/Mobile browser evidence checks. No merge, production deployment or manual hosted configuration mutation is authorized by this task branch.

## Request

- Stop production Supabase Auth from continuing to send the old hosted email after repository templates are merged.
- Always expose an account sign-out action for an authenticated email session, including accounts with zero linked nicks.
- Make sign-out complete on the current browser so the user can immediately open login and registration again without clearing cookies, storage or cache manually.
- Keep password recovery available from login with explicit wording.
- Let an authenticated email user change their password from Mi cuenta.
- Reuse one dedicated password page for both an authenticated password change and a recovery-link reset.

## Evidence

- PR #52 generated and tested the branded email catalogue but intentionally left hosted activation as a manual post-merge operation.
- The production deployment workflow already has the protected `production` environment, `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_ID`, but does not PATCH or verify hosted Auth `mailer_*` configuration.
- Supabase hosted projects send Auth emails from project-level configuration; `supabase/config.toml` and repository HTML only configure local development. Supabase can also fall back to its default message when a hosted template is missing or invalid.
- Since 3 June 2026, newly created Free projects using Supabase default SMTP cannot customize Auth templates. Paid projects and Free projects with custom SMTP remain eligible. The observed Brevo sender suggests custom SMTP, but the deployment must report an exact API rejection rather than silently claiming success.
- `cuenta.html` contains a cloud sign-out button, but the current operation only clears the Supabase session and explicitly leaves the local account key active.
- Auth route guards treat a local account token, remembered account nick or legacy local nick as an active account. Consequently cloud-only sign-out can still redirect login and registration back to Mi cuenta.
- `restablecer-clave.html` already updates an authenticated Supabase session, but its copy and controller only model recovery-link usage and it is not reachable from the authenticated account panel.
- Login already sends a recovery request, but the action label is not explicit enough to read as the conventional forgotten-password path.

## Decisions

1. Extend the existing protected Supabase production workflow rather than adding an independent privileged workflow.
2. Synchronize the complete generated hosted Auth payload through the Supabase Management API on every production Supabase deployment. Read current configuration first, PATCH only when managed keys drift, then fetch again and fail unless every managed value matches exactly.
3. Never print the access token or full HTML payload in logs. Report only managed key names, HTTP status and a bounded API error body.
4. Treat hosted template synchronization failure as a deployment failure. Explain likely Free/default-SMTP restrictions when the Management API rejects customization, while retaining the original response for diagnosis.
5. Keep synchronization logic dependency-free, testable through injected `fetch`, and covered at 100% lines/functions/branches.
6. Replace the cloud-only sign-out semantics with an explicit complete browser sign-out after confirmation: revoke the Supabase session when reachable and always clear Supabase session/PKCE state, pending confirmation state, account token, remembered account nicks and legacy local player credentials.
7. Remote logout failure must not trap the user in the local session. The browser clears all local credentials and reports that remote revocation could not be confirmed.
8. Preserve the separate private-key card action, but make its wording clear that it removes only the local private-key session.
9. The complete sign-out action is rendered solely from authenticated state and does not depend on linked-player count or the account-players request.
10. Add a password-management link only when the authenticated identity includes the `email` provider. Google-only users do not have a password-management action.
11. Reuse `restablecer-clave.html` as a dual-purpose password page. Determine `recovery` mode when a recovery callback creates the session; otherwise an existing email session enters `change` mode.
12. In change mode require the current password plus a valid, exactly confirmed new password. In recovery mode require only the valid, exactly confirmed new password.
13. Extend the direct Supabase Auth client update request with optional `current_password`; do not duplicate password policy or visibility controls.
14. After a successful update, keep the valid session and expose a clear return to Mi cuenta. Recovery and authenticated change use mode-specific title, lead, labels, autocomplete and success copy.
15. Keep guest-only login/register guards. Complete sign-out must remove every local state input that those guards consider authenticated.

## Acceptance criteria

1. Production Supabase deployment computes the generated hosted Auth payload, detects managed-key drift, applies it with the protected Management API token and verifies exact post-PATCH equality.
2. A no-drift deployment performs no PATCH.
3. Missing credentials, GET failure, PATCH failure and persistent post-PATCH drift fail with actionable output and no secret or HTML disclosure.
4. Template source/config/generator changes trigger the production Supabase workflow.
5. An authenticated email account with zero players shows `Cambiar contraseña` and `Cerrar sesión`.
6. Google-only authenticated accounts show complete sign-out but not password change.
7. Complete sign-out calls Supabase logout once when a session exists and clears Supabase session, PKCE/return state, pending email confirmation, account token, remembered account nicks and legacy local credentials even when remote logout fails.
8. After complete sign-out, Mi cuenta renders guest actions and both `login.html` and `registro.html` remain accessible without manual browser cleanup.
9. A subsequent email login succeeds in the same browser session.
10. Login exposes an explicit forgotten-password action and sends exactly one neutral recovery request for a valid email.
11. An authenticated email user reaches the reusable password page from Mi cuenta, sees change-password copy and must provide the current password.
12. A recovery callback reaches the same page with reset-password copy and does not request the current password.
13. Both modes enforce the shared password policy, exact confirmation and password visibility component.
14. The authenticated update sends `current_password`; recovery sends only the new password.
15. Desktop and Mobile Playwright journeys prove zero-player sign-out, re-login, register-route access, authenticated password change, recovery reset, keyboard-accessible controls, no unexpected page/console/network failures and no horizontal overflow.
16. The final branch produces the required platform evidence artifact and embeds the changed account/password surfaces in the PR.

## Validation plan

- 100% coverage for hosted email synchronization and password-page mode decisions.
- Supabase Auth client tests for local cleanup, remote failure and optional current-password payload.
- Auth experience/access tests for email-provider password capability and complete local-session clearing.
- Workflow contract tests for production environment, exact secrets/variables, trigger paths, apply command and least-privilege permissions.
- Playwright Desktop/Mobile complete journeys with an authenticated zero-player account, successful logout and re-login, registration accessibility, authenticated password change and recovery reset.
- Existing `pnpm check`, Authentication Quality, Pull Request Quality Pipeline, Public Asset Audit, Player Pages and Social Cards and Pull Request Visual Evidence workflows.

## Risks

- **Free/default SMTP restriction:** hosted PATCH may be rejected for a newly created Free project without custom SMTP. The deployment will fail with the Supabase response and remediation instead of leaving stale templates unnoticed.
- **Template parser fallback:** a syntactically accepted configuration can still fail at send time. Hosted Auth logs and real email smoke messages remain required after deployment.
- **Logout data loss:** complete sign-out intentionally removes local private credentials. The UI requires explicit confirmation and explains that a recoverable cloud login is needed to regain linked progress.
- **Remote revocation outage:** local credentials are still cleared. The UI warns that server revocation could not be confirmed and recommends changing the password if the session may be compromised.
- **Current-password project setting:** sending `current_password` supports the stricter hosted configuration without weakening projects where it is optional.
- **Recovery callback ambiguity:** mode detection uses callback/session provenance rather than copy-only URL assumptions and is covered for existing-session, callback-created-session and invalid-session paths.

## Rollback

- Revert the branch before merge.
- After merge, restore the previous workflow/script with a normal revert; do not expose or rotate secrets in source.
- Hosted Auth configuration can be restored from the pre-sync `mailer_*` export through the Management API or Dashboard.
- Password/session changes are client-only and can be reverted without database migration.

## Delivery

- Branch: `agent/fix-auth-session-password-emails`
- Base: `main` at or after `a278b85588cfa908d532a6a211e57fdc47ef2900`.
- One normal, non-draft pull request.
- No merge or production deployment from this task.