# Authentication and account linking

Minuto 106 supports optional recovery through Supabase Auth while preserving anonymous play and the existing 64-character private account key.

## Supported methods

- Google OAuth.
- Facebook OAuth.
- Confirmed email and password.
- Existing anonymous private key.

The game account remains the canonical aggregate. A Supabase user is a credential that points to that account; it is not the source of nicknames, attempts, leagues, trophies or achievements.

## Public runtime configuration

GitHub Actions repository variables:

| Variable | Purpose |
|---|---|
| `SUPABASE_PROJECT_ID` | Supabase project reference. |
| `SUPABASE_FUNCTIONS_URL` | Public `game-api` URL. |
| `SUPABASE_PUBLISHABLE_KEY` | Public browser key beginning with `sb_publishable_`. |
| `PUBLIC_SITE_URL` | Canonical GitHub Pages URL. |
| `TURNSTILE_SITE_KEY` | Public CAPTCHA key when Supabase Auth CAPTCHA protection is enabled. |

`SUPABASE_PUBLISHABLE_KEY` is intentionally emitted into the generated production `public/config.js`. It does not bypass RLS or authorize private RPCs. Never replace it with `sb_secret_`, `service_role` or any provider secret.

GitHub repository variables are available to Actions, not to a developer shell. For local development, `pnpm dev` runs `supabase status -o env` and injects only the local public `API_URL` and `ANON_KEY` into `/config.js`. Start local Supabase first:

```bash
pnpm supabase:start
pnpm dev
```

No production key needs to be copied into the repository. Explicit local environment values still take precedence when a non-default local stack is required.

## Private configuration

The following values stay in Supabase or protected GitHub environments and never reach Pages:

- Google OAuth client secret.
- Facebook app secret.
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
https://<project-ref>.supabase.co/auth/v1/callback
```

## Provider configuration

### Google

Create a Google OAuth Web application with:

- Authorized JavaScript origin: `https://juanjogondev.github.io`
- Authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`
- Scopes: `openid`, email and profile only.

Paste the client ID and secret into Authentication → Sign In / Providers → Google.

### Facebook

Create a Meta app with Facebook Login and:

- Site URL: `https://juanjogondev.github.io/106`
- Valid OAuth redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`
- Permissions: `public_profile` and `email`.
- Privacy policy: `/106/privacidad.html`
- Terms: `/106/legal.html`

Paste the app ID and app secret into Authentication → Sign In / Providers → Facebook. Development-mode apps admit only configured administrators, developers and testers.

### Email and password

Authentication → Sign In / Providers → Email:

- Enable Email provider.
- Allow new users to sign up.
- Require email confirmation.
- Enable secure email changes.
- Use a minimum password length of 10 characters.

The browser additionally requires lowercase, uppercase, number and symbol. Registration and password reset display every requirement independently and require the password to be entered twice. Sign-in only requires the existing password. Recovery and registration use neutral messages so the UI does not reveal whether an email exists.

## One-time email confirmation reward

After Supabase consumes the email confirmation link and exposes `email_confirmed_at`, the next authenticated synchronization grants:

- One account-level `verified_email_daily_attempt` entitlement.
- One additional daily attempt for every nickname on the canonical game account.
- The `Cuenta confirmada` achievement, worth 10 points, for every current and future nickname on that account.

The entitlement is unique per canonical account and cannot stack through callback replay, repeated login, multiple tabs or multiple confirmed email identities. Google and Facebook identities do not claim this specific email-link incentive. The bonus contributes inside the existing bonus ceiling: the absolute daily maximum remains 10.

The email address remains private. Public profiles may show the achievement because it is intentionally a user-facing reward, but they never expose the address.

## SMTP

The current free setup uses Brevo SMTP with a verified sender. Supabase custom SMTP values:

- Host: `smtp-relay.brevo.com`
- Port: `587`
- Username: the Brevo SMTP login.
- Password: a dedicated Brevo SMTP key.
- Sender: the exact verified sender.

Do not place SMTP credentials in GitHub. Keep Auth rate limits conservative and enable Turnstile before public registration.

## Browser flow

1. Anonymous play creates or reuses the local private key.
2. The user signs in through Google, Facebook or email.
3. The browser sends the verified Supabase JWT and, when present, the current private key to `account-auth`.
4. `account-auth` validates the JWT with Supabase Auth and hashes the private key using the server pepper.
5. The service-role-only database function links the Supabase user to the game account.
6. For a confirmed email provider, a second service-role-only function grants or reuses the idempotent confirmation entitlement and synchronizes achievements.
7. On a clean device, the server issues a new private key for the same game account. Only its hash is stored.

Signing out of Supabase does not remove the local private key. Closing the local account does not delete the Supabase identity or server progress.

## Cross-account merge

When the signed-in identity and current private key resolve to different game accounts:

1. The database locks the identities and calculates every consequence.
2. A short-lived proposal stores the impact and SHA-256 fingerprint.
3. The browser shows an accessible modal listing invalid leagues, trophies, achievements, self-duels, self-referrals and bonus-attempt corrections.
4. Cancel marks the proposal cancelled and mutates no competitive data.
5. Confirm re-locks both accounts and recomputes the impact inside the transaction.
6. A changed fingerprint rejects the proposal as stale.
7. A valid confirmation applies corrections, records the complete impact and redirects every old private key to the canonical account.

The merge preserves attempts and nickname history. Derived rewards that are no longer valid are removed, and the immutable merge event retains their complete prior snapshot for audit. Email entitlements are resolved through the canonical account, so merging two confirmed accounts still produces only one daily bonus.

## Database boundary

All `game_*` tables remain server-owned:

- RLS enabled.
- No direct DML grants for `anon` or `authenticated`.
- No direct execution of privileged functions for `PUBLIC`, `anon` or `authenticated`.
- Service-role access only through repository-owned Edge Functions.

`pnpm test:supabase` enumerates the complete schema and performs real PostgREST probes with both an anonymous key and an authenticated user JWT. Adding a table, sequence or privileged function without the same boundary fails CI.

## Local validation

```bash
pnpm install --frozen-lockfile
pnpm check
bash scripts/run-supabase-ci.sh
PR_VISUAL_CAPTURE=1 pnpm test:e2e
```

The local Supabase integration creates confirmed users through the local admin API, signs in through the password endpoint, exercises `account-auth`, grants and replays the confirmed-email reward, links future nicknames, recovers a game account on a clean device, confirms/cancels/stales merge proposals and verifies role isolation.

## Rollback

The migrations are additive. A frontend or Edge Function regression can be reverted while identity, credential, entitlement and merge-audit tables remain dormant. Do not rewrite an applied migration. Any production correction must be a new forward migration.
