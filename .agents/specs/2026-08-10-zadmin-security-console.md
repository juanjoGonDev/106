# Zadmin security console

## Request

Add an unlinked administrative surface at `/zadmin` for investigating players and integrity signals, correlating nicknames/accounts/IP fingerprints, reviewing attempts and active restrictions, and applying or revoking manual bans by account, nickname or IP fingerprint.

Protect the surface with a dedicated server-side username/password boundary supplied at production deployment through GitHub Actions secrets `ZU_ADMIN_USER` and `ZU_ADMIN_PSW`. Limit failed logins to three attempts in a rolling hour independently by IP and browser-device identifier.

## Evidence

- The product is a static vanilla-ESM frontend served from `public/`; the local server already resolves directory `index.html` routes.
- Local manual validation exposed a slashless-route regression: loading `/zadmin` served the page but relative `./zadmin.js` / `./zadmin.css` references resolved as root files, received the SPA HTML fallback with `text/html`, and prevented the admin module from mounting.
- Because the admin JavaScript did not mount, native form submission reloaded the page and serialized named username/password controls into URL query parameters. This is both a UX and credential-handling defect.
- `pnpm dev:local` generated the Edge Function `.env` without local `ZU_ADMIN_USER` / `ZU_ADMIN_PSW`, so the repaired client would otherwise reach an unconfigured local `zadmin-api`.
- Supabase Edge Functions are the privileged browser-to-database boundary. `game-api` already hashes device/IP inputs with `HASH_PEPPER` and rejects disallowed origins.
- Policy v3 already owns automatic integrity evidence in `game_attempt_integrity` (`eligible`, `watch`, `excluded`, `risk_score` 0-100) and automatic temporary bans in `game_integrity_bans` for account/device/IP scopes.
- Policy v3 deliberately treats timing precision and shared IP as evidence rather than sufficient proof. The admin UI must preserve that false-positive guardrail.
- Existing production deployment sets Edge Function secrets in `.github/workflows/supabase.yml`; GitHub Actions secrets are not browser runtime configuration.
- Repository policy requires 100% line/function/branch coverage for new isolated security decision logic, real Supabase validation for critical backend behavior, Desktop/Mobile browser acceptance, and platform evidence for new visual states.
- Adding database migrations advances the repository-wide player-card cache boundary; `PLAYER_CARD_RENDERER_REVISION` and all maintained loaders must remain strictly newer than the newest migration.

## Decisions

### Authentication boundary

- `ZU_ADMIN_USER` and `ZU_ADMIN_PSW` exist only in the Edge Function environment. They are never emitted in production runtime config, HTML, JavaScript, logs, database rows or API responses.
- Credential comparison hashes both supplied and expected values before fixed-length comparison to avoid username-existence and early-string-comparison timing differences.
- A successful login receives a cryptographically random opaque session token. Only its peppered hash is stored in PostgreSQL.
- The raw session token is held in browser memory only. It is never persisted to Local Storage, Session Storage, IndexedDB or cookies; refresh intentionally requires a new login.
- Sessions expire after 30 minutes and are bound to the login IP fingerprint and browser-device identifier. Logout revokes the session server-side.
- Failed credentials use one generic response. Password/user values and bearer tokens are never logged.
- Local development may generate ephemeral admin credentials into the ignored `supabase/functions/.env`; production credentials remain Actions/Supabase secrets only.

### Brute-force protection

- PostgreSQL is the canonical rolling-window gate so concurrent Edge Function instances cannot bypass it.
- Failed attempts are counted independently for the peppered IP fingerprint and peppered browser-device identifier.
- Three failures in the previous rolling hour block further logins for that subject until the oldest applicable failure leaves the window.
- The database acquires deterministic advisory locks for both rate-limit subjects before counting/inserting, preventing concurrent requests from racing past the three-failure limit.
- A client device identifier is useful only as an additional throttle signal because it can be reset/spoofed. IP and device limits therefore apply independently.

### Manual bans

- Keep automatic policy-v3 bans immutable and separate from operator decisions.
- Store manual bans in `game_admin_bans` with scopes `account`, `nick`, `ip`, reason, creator session, optional expiry and revocation metadata.
- Allowed durations are each whole hour from 1 through 24, one week, or permanent.
- A manual ban can be revoked but is not deleted; ban/revoke operations append an admin audit event.
- Extend the existing canonical `get_game_active_integrity_ban*` functions to consult manual bans before the existing automatic policy-v3 owner. This preserves current ranked start/prepare callers and avoids duplicating enforcement across browser layers.
- IP actions use the existing peppered IP fingerprint, not newly persisted raw addresses.

### Investigation and risk presentation

- Reuse the existing policy-v3 `risk_score` and statuses. Do not invent a new statistical probability or imply calibration that does not exist.
- The UI labels the number as an integrity risk score, not “chance of cheating”.
- Show corroborating evidence: attempt counts, excluded/watch counts, best/max/average integrity score, linked nick/account/IP/device fingerprints, recent attempt history, risk-score distribution, active bans and the policy reasons already recorded by the integrity engine.
- Never auto-ban from the admin dashboard score. Operator actions require an explicit duration and reason.

### Frontend

- Create a standalone `/zadmin/` page with no entry in the product layout/navigation.
- `/zadmin` and `/zadmin/` must load the same canonical route-owned assets; admin CSS/JS paths are absolute so correctness does not depend on trailing-slash normalization by the host.
- Do not load `layout.js` on the admin page, so the route remains intentionally undiscoverable from normal navigation.
- Reuse existing base visual CSS and add a narrowly scoped admin stylesheet. No new UI/chart dependency.
- The unauthenticated state is a centered, bounded login card with consistent internal spacing rather than page-width form controls. Dashboard remains responsive and width-efficient after authentication.
- The login form keeps semantic Enter submission when JavaScript is healthy, but its HTML fallback is `POST` and username/password controls have no serialization names so a script-loading regression cannot place credentials in the URL.
- Use a mobile-first single-column flow; desktop adds a list/detail workspace without changing task order.
- Use semantic tables with local horizontal overflow only where comparison requires it, persistent labels, visible focus, 44px primary controls and status messages.
- Destructive ban and revoke confirmation uses inline application components in the relevant workflow. The zadmin route must not use `alert`, `confirm`, `prompt`, `<dialog>`, `HTMLDialogElement` or `showModal()`.
- Escape cancels a pending destructive component and returns focus to the control that opened it. Pending actions are also cancelled when the investigated entity, active view or admin session changes so stale context cannot be submitted.

### Local development

- `pnpm dev:local` remains the canonical local entrypoint after `pnpm supabase:setup` or with an already-running local stack.
- Each `dev:local` run writes a fresh random local-only zadmin password plus the fixed local username `local-admin` into the ignored, mode-0600 Edge Function `.env` and prints those ephemeral credentials to the developer terminal.
- Local readiness includes an `OPTIONS` probe against `zadmin-api` so the command does not claim the environment is ready while the admin Edge Function is unavailable.
- No local default credential is reused by the production deployment workflow.

## Acceptance criteria

- `/zadmin/` is reachable directly but absent from normal navigation/layout.
- `/zadmin` without a trailing slash loads the same admin CSS/JS successfully and produces no module MIME error.
- Pressing Enter in the password field uses the application login flow and does not add username/password query parameters.
- If the application module fails to load in a future regression, the HTML form fallback cannot serialize the admin username/password into the URL.
- The unauthenticated view is a centered, bounded login card with professional spacing on desktop and mobile rather than full-width controls.
- `pnpm supabase:setup` followed by `pnpm dev:local` produces a usable local zadmin environment and prints ephemeral local-only login credentials.
- Login credentials are server-only in production and production deployment fails closed when either required secret is missing.
- Invalid username and invalid password are indistinguishable to clients.
- The third failed submission inside one rolling hour consumes the limit and blocks further logins for the same IP or same device, including concurrent requests, until that subject leaves the rolling window.
- A valid password cannot bypass an already-active rate-limit block.
- Session tokens are random, stored only as hashes server-side, bound to IP/device and expire after 30 minutes.
- Reloading the page does not restore an admin session.
- Admin requests without a valid bound session are rejected.
- Accounts, nicknames and IP fingerprints can be searched/reviewed with recent attempt/integrity context.
- Risk is presented as the existing 0-100 integrity score with status/reasons, never as a calibrated probability.
- Manual account/nick/IP bans support 1-24 hours, 1 week and permanent duration plus mandatory reason.
- Ban enforcement reuses the canonical ranked restriction lookup and preserves automatic policy-v3 bans.
- Manual bans can be revoked without deleting audit history.
- Ban/revoke confirmation is an application-owned inline component; no browser-native alert, confirmation, prompt or modal primitive is used by `/zadmin`.
- Public/anon/authenticated roles cannot read admin login/session/audit/manual-ban data or invoke privileged admin RPCs.
- New frontend states have Desktop/Mobile acceptance and platform evidence coverage.
- The global player-card renderer revision remains newer than every migration introduced by the feature and all maintained loader URLs use that same revision.
- No real secret, raw password, raw session token or new raw gameplay IP storage is committed.

## Security edge cases

- Slashless `/zadmin` route with route-relative assets.
- JavaScript/module load failure followed by Enter/native form submission.
- Missing/invalid device identifier.
- Disallowed Origin and preflight.
- Oversized and malformed JSON requests.
- Missing or malformed bearer token.
- Wrong username, wrong password, both wrong and Unicode inputs.
- Third failure, subsequent blocked attempt, exact rolling-window expiry and independent IP/device counters.
- Concurrent failed attempts for the same rate-limit subject.
- Correct credentials while blocked.
- Expired, revoked, wrong-IP and wrong-device sessions.
- Invalid ban scope, nonexistent target, unsupported duration, empty/oversized reason and duplicate active ban.
- Permanent ban and timed-ban expiry.
- Revoke already-revoked/nonexistent ban.
- Automatic integrity ban remains effective independently of manual ban lifecycle.
- Escape/context changes while ban or revoke confirmation is pending.

## Validation plan

- 100% Node coverage for isolated zadmin core validators/credential comparison/aggregation.
- Vitest static security contracts for secret handling, deployment wiring, RLS/grants, session storage, canonical ban enforcement, absolute route-owned assets, fail-safe form serialization and absence of browser modal primitives in zadmin.
- Local-dev plan coverage includes the zadmin URL and Edge Function readiness endpoint.
- Supabase migration reset/lint via the existing CI matrix; add database-level assertions for the new privilege/rate/session/ban contracts where practical.
- Playwright Desktop/Mobile tests for login errors, blocked state, authenticated dashboard, search/detail, inline ban/revoke component UX, Escape/focus recovery, keyboard flow and 320px overflow.
- Add explicit Playwright coverage starting at slashless `/zadmin`, assert centered login geometry, successful Enter submission, no MIME console error and no credential query parameters.
- Keep the repository-wide player radar/card revision synchronization test green after the new migrations.
- Add `zadmin-login` and `zadmin-dashboard` to the platform screenshot inventory and produce final-head Desktop/Mobile PNG evidence.
- Existing format/lint/Knip/unit/security/Supabase/build/browser/platform-evidence workflows must remain green.

## Delivery

- Branch: `agent/feat-zadmin-security-console`
- One normal non-draft PR.
- No merge, production deployment, production migration or secret creation is authorized.
- Required operator configuration before deployment: create GitHub Actions secrets `ZU_ADMIN_USER` and `ZU_ADMIN_PSW` with a unique high-entropy password.

## Rollback

Revert the application/workflow changes. If the migration has already been applied, do not rewrite it; use a forward migration to disable/revoke manual admin access while retaining audit history.

## Status

Follow-up regression fix implemented after local validation exposed slashless asset loading, credential-query fallback, local zadmin configuration and login-layout defects. Final CI, local-runtime contract and refreshed visual evidence are in progress; the PR remains intentionally unmerged.