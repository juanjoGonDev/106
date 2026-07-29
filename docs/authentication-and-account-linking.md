# Authentication and account linking

Minuto 106 supports optional recovery through Supabase Auth while preserving anonymous play and the existing 64-character private account key.

## Supported methods

- Google OAuth.
- Confirmed email and password.
- Existing anonymous private key.

Google is the only social authentication provider. The game account remains the canonical aggregate. A Supabase user is a credential pointing to that account; it is not the source of nicknames, attempts, leagues, trophies or achievements.

One game account may contain an email identity and a Google identity. The private key or the explicit merge flow proves which game account receives the new identity.

## Public runtime configuration

GitHub Actions repository variables:

| Variable | Purpose |
|---|---|
| `SUPABASE_PROJECT_ID` | Supabase project reference. |
| `SUPABASE_FUNCTIONS_URL` | Public `game-api` URL. |
| `SUPABASE_PUBLISHABLE_KEY` | Public browser key beginning with `sb_publishable_`. |
| `PUBLIC_SITE_URL` | Canonical GitHub Pages URL. |
| `TURNSTILE_SITE_KEY` | Public CAPTCHA key when Supabase Auth CAPTCHA protection is enabled. |

`SUPABASE_PUBLISHABLE_KEY` is intentionally emitted into generated production `public/config.js`. It does not bypass RLS or authorize private RPCs. Never replace it with `sb_secret_`, `service_role` or a provider secret.

GitHub repository variables are available to Actions, not to a developer shell. For local development, start local Supabase before the web server:

```bash
pnpm supabase:start
pnpm dev
```

The development server reads only the local public `API_URL` and `ANON_KEY` from `supabase status -o env`. No production key is copied into the repository.

## Private configuration

These values stay in Supabase or protected GitHub environments and never reach Pages:

- Google OAuth client secret.
- Brevo SMTP key.
- Supabase secret/service-role key.
- `HASH_PEPPER`.
- Turnstile secret key.

## Supabase URL configuration

Authentication → URL Configuration:

- Site URL: `https://juanjogondev.github.io/106`
- Redirect URLs:
  - `https://juanjogondev.github.io/106/cuenta.html`
  - `https://juanjogondev.github.io/106/restablecer-clave.html`
  - `http://localhost:3000/cuenta.html`
  - `http://localhost:3000/restablecer-clave.html`
  - `http://127.0.0.1:3000/cuenta.html`
  - `http://127.0.0.1:3000/restablecer-clave.html`

The OAuth provider callback is the Supabase callback, not GitHub Pages:

```text
https://imtitjwgiemlaabpioed.supabase.co/auth/v1/callback
```

## Google

Create a Google OAuth Web application with:

- Authorized JavaScript origin: `https://juanjogondev.github.io`
- Authorized redirect URI: `https://imtitjwgiemlaabpioed.supabase.co/auth/v1/callback`
- Scopes: `openid`, email and profile only.

Paste the client ID and secret into Authentication → Sign In / Providers → Google. Disable every unused social provider in the hosted Supabase project.

## Email and password

Authentication → Sign In / Providers → Email:

- Enable Email provider.
- Allow new users to sign up.
- Require email confirmation.
- Enable secure email changes.
- Minimum password length: 10.
- Confirmation/OTP expiry: 3,600 seconds.
- Minimum resend interval: one minute.

The browser additionally requires lowercase, uppercase, number and symbol. Registration and password reset display every requirement independently and require the password twice. Sign-in only requires the existing password.

### Confirmation and resend

The signup confirmation link is one use and expires after one hour. `cuenta.html` keeps a neutral pending state and can call Supabase `/auth/v1/resend` with type `signup`. The page shows a local one-minute cooldown; Supabase rate limits remain authoritative. Responses never reveal whether an email exists.

For hosted Supabase, configure the one-hour expiry and email template in the dashboard. `supabase/config.toml` and `supabase/templates/confirmation.html` configure the local stack and provide the maintained production template source, but do not automatically change hosted Auth settings.

Confirmation email subject:

```text
Confirma Minuto 106 y gana +1 intento diario
```

The hosted template should use the maintained file `supabase/templates/confirmation.html`, including `{{ .ConfirmationURL }}`.

## Authentication incentive

A canonical game account receives at most one authentication incentive:

```text
auth_identity_daily_attempt = +1 daily attempt
```

The entitlement is unique at account level, canonical across merges and protected by an advisory transaction lock.

### Account created through normal email

- Before confirmation: no bonus.
- After opening the one-use link: +1 daily attempt.
- Unlocks `Cuenta confirmada`, worth 10 points, for every current and future nick.
- Linking Google later is allowed but grants no additional bonus.

### Account first linked through Google

- First successful Google link: +1 daily attempt.
- Repeated login and account recovery reuse the same entitlement.
- No `Cuenta confirmada` achievement is created because no normal-email activation was completed.

The first cloud identity linked to the game account fixes its reward origin. Replaying callbacks, repeated login, multiple tabs, adding an email identity or merging accounts cannot stack rewards. The bonus remains inside the absolute daily limit ceiling of 10.

## SMTP

The current free setup uses Brevo SMTP with a verified sender:

- Host: `smtp-relay.brevo.com`
- Port: `587`
- Username: the Brevo SMTP login.
- Password: a dedicated Brevo SMTP key.
- Sender: the exact verified sender.

Do not place SMTP credentials in GitHub. Keep Auth rate limits conservative and enable Turnstile before public registration.

## Browser flow

1. Anonymous play creates or reuses the local private key.
2. The user signs in through Google or email.
3. The browser sends the validated Supabase JWT and current private key, when present, to `account-auth`.
4. `account-auth` validates the JWT, rejects unsupported identity providers and hashes the private key with the server pepper.
5. A service-role-only RPC links the Supabase UUID to the game account.
6. The database records the immutable origin provider for that identity.
7. When no merge is pending, the database grants or reuses the one account-level authentication entitlement.
8. On a clean device, the server issues a new private key for the same canonical game account. Only its hash is stored.

Signing out of Supabase does not remove the local private key. Closing the local account does not delete Supabase identities or server progress.

## Cross-account merge

When the signed-in identity and current private key resolve to different game accounts:

1. PostgreSQL locks both identities and calculates every consequence.
2. A short-lived proposal stores the impact and SHA-256 fingerprint.
3. The browser shows invalid leagues, trophies, achievements, self-duels, self-referrals and attempt corrections.
4. Cancel mutates no competitive data.
5. Confirm re-locks and recomputes the impact in the same transaction.
6. A changed fingerprint rejects the proposal as stale.
7. A valid confirmation records the audit event and redirects every old private key to the canonical account.
8. The authentication entitlement is evaluated only after the merge completes.

The merge preserves attempts and nickname history. Rewards no longer valid are removed, while immutable merge history retains their previous snapshot.

## Database boundary

All `game_*` tables remain server-owned:

- RLS enabled.
- No direct DML grants for `anon` or `authenticated`.
- No direct execution of privileged functions for `PUBLIC`, `anon` or `authenticated`.
- Service-role access only through repository-owned Edge Functions.

`pnpm test:supabase` enumerates the schema and performs real PostgREST probes with anonymous and authenticated JWTs. Adding a table, sequence or privileged function without the same boundary fails CI.

Provider constraints use forward-only migrations. Historical rows are not rewritten during deployment, while new inserts and updates accept only email and Google identities.

## Local validation

```bash
pnpm install --frozen-lockfile
pnpm check
bash scripts/run-supabase-ci.sh
PR_VISUAL_CAPTURE=1 pnpm test:e2e
```

Local integration covers email reward grant/replay/future nick, pending email, Google reward deduplication, email-origin exclusion, account recovery, merge lifecycle, provider rejection and role isolation.

## Production activation order

1. Merge the required PR after final CI approval.
2. Apply production database migrations.
3. Set `HASH_PEPPER` and deploy `account-auth`.
4. Configure hosted Auth URLs, email policy, one-hour expiry and template.
5. Confirm Brevo SMTP delivery.
6. Enable Google and disable every other social provider in Supabase.
7. Deploy GitHub Pages with `SUPABASE_PUBLISHABLE_KEY`.
8. Run real smoke tests for email confirmation/resend, Google linking and clean-device recovery.

## Rollback

Migrations are additive. A frontend or Edge Function regression can be reverted while identity, origin, entitlement and merge-audit rows remain dormant. Never rewrite an applied migration; production corrections require a new forward migration.
