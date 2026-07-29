# Security policy

## Secret handling

Never commit or expose:

- Supabase secret or `service_role` key
- Supabase personal access token
- PostgreSQL password or connection string
- `HASH_PEPPER`
- Cloudflare Turnstile secret key
- Google or Facebook OAuth client secret
- Brevo SMTP key, SMTP password or provider API key
- Registry credentials or authentication tokens in `.npmrc`, `pnpm-workspace.yaml` or the lockfile

The browser may receive the Edge Function URLs, the Turnstile site key and `SUPABASE_PUBLISHABLE_KEY`. They are public identifiers by design, not privileged credentials. A publishable key must never be treated as authorization: every data decision still requires RLS, restricted grants, a validated user JWT or a server-owned credential boundary.

## Dependency supply chain

The repository uses only pnpm with the exact Node.js and pnpm versions pinned in `package.json`. Volta provides the same toolchain locally.

Required controls:

- `pnpm-lock.yaml` is the only accepted lockfile.
- CI installs with `pnpm install --frozen-lockfile`.
- Direct dependencies use exact semantic versions without ranges or mutable tags.
- Dependency build and install scripts are denied by default through an empty `allowBuilds` policy and `strictDepBuilds`.
- Any build-script exception must be restricted to an audited package and version, justified in review and tested in CI.
- Packages published less than seven days ago are rejected by default.
- Integrity downgrades, exotic subdependencies, automatic peer installation and non-strict peers are rejected.
- CI caches only the pnpm content-addressable store; `node_modules` is never restored from a cache.
- Project lifecycle scripts such as `preinstall`, `install`, `postinstall` and `prepare` are forbidden.
- `package-lock.json`, Yarn and Bun lockfiles are forbidden.

Run before merging dependency changes:

```bash
pnpm install --frozen-lockfile
pnpm check:package-policy
pnpm audit --audit-level=high
pnpm check
```

Do not bypass a frozen-lockfile, release-age, integrity or build-script failure merely to make CI pass. Review the dependency and make the minimum explicit policy change instead.

## Data access

The frontend must not access server-owned `game_*` tables through the Supabase Data API. RLS is enabled and database grants are revoked for `anon` and `authenticated`. Game writes go through `game-api`; authenticated account linking goes through `account-auth`. Both execute private RPC functions with `service_role` only inside Supabase Edge Functions.

CI enumerates every server-owned game table, sequence and privileged function and fails when either `anon` or `authenticated` gains direct DML or execution privileges. It also performs real PostgREST probes with an anonymous key and a signed-in user JWT.

## Supabase Auth boundary

Google, Facebook and email/password are optional recovery credentials for an existing game account. They do not replace the private account key.

- The browser sends a Supabase user JWT only to Supabase Auth and the dedicated `account-auth` Edge Function.
- `account-auth` validates the JWT against the same Supabase project and uses the immutable `auth.users.id` for authorization.
- Browser-provided email, provider metadata or account identifiers are never trusted for authorization.
- The verified email is private contact data and must not appear in rankings, profiles, social cards, analytics, logs or public API responses.
- Provider access tokens and refresh tokens are not copied into game tables.
- Existing and newly issued private account keys are stored only in the browser; PostgreSQL receives their peppered hashes.
- A JWT that maps to a different game account cannot merge it silently with the current private key. The server creates a short-lived impact proposal and requires explicit confirmation.
- Confirmation locks both accounts, recomputes the impact, rejects stale proposals and records the complete correction snapshot.
- Old private keys continue resolving to the canonical merged account so a successful merge does not strand devices.

Email registration, password login and recovery use Supabase Auth rate limits and Turnstile when configured. User-visible responses for registration and recovery remain neutral and must not reveal whether an email is registered.

## CORS origin policy

The Edge Functions use an explicit origin allowlist and never use `Access-Control-Allow-Origin: *`.

- Browser `Origin` values contain only scheme, host and port. Repository paths such as `/106/` are not part of the origin.
- Production deployment generates `ALLOWED_ORIGINS` with `scripts/build-allowed-origins.mjs`.
- `PUBLIC_SITE_URL` and additional configured URLs are normalized through `URL.origin` before being stored as an Edge Function secret.
- The canonical `https://<repository-owner>.github.io` origin and local development origins are always included.
- Invalid schemes, embedded credentials and malformed URLs fail the deployment instead of weakening CORS.
- The Supabase integration job performs a real `OPTIONS` preflight and verifies the returned allow-origin header.

For this repository, both `https://juanjogondev.github.io` and a configured value such as `https://juanjogondev.github.io/106/` resolve to the same permitted browser origin.

## Competition isolation

A challenge is issued with an immutable competition context:

- `league_id = null` for global play.
- A concrete `league_id` for a miniliga attempt.

The finish request contains only the challenge identifier. The server reads the stored context and copies it into the attempt; it never accepts a client-selected league during `finish`.

Consequences:

- A league attempt cannot be promoted to the global ranking.
- A global attempt cannot be copied into a league.
- Attempts cannot move between leagues.
- Global profiles, scores, awards, referrals and duels explicitly filter `league_id is null`.
- League standings filter by their exact `league_id`.
- Starting a league attempt requires active membership and an unexpired league.

## Visual human verification

Every attempt requires a one-time visual check before the game challenge is created:

- The Edge Function generates four numbered football positions with a minimum separation.
- The browser draws the complete challenge on one canvas and accepts only trusted mouse, touch or pen presses.
- The Edge Function bounds and normalizes click coordinates, order, timing and pointer type.
- PostgreSQL validates each click against the server-issued geometry.
- A successful completion returns a random proof token; only its peppered hash is stored.
- The proof is bound to the device and IP hashes, expires quickly and is consumed once by `start`.
- Cloudflare Turnstile is additionally verified when its site and secret keys are configured.

The final stop is also pointer-only. It is rendered in a closed shadow root on canvas and accepts only a trusted `pointerdown` from mouse, touch or pen. Keyboard input is not a valid finish path.

Canvas and closed shadow roots remove stable DOM selectors, but they do not make browser state secret. A determined attacker can inspect JavaScript and network traffic. The security boundary remains the server-issued proof, one-time consumption, wall-clock validation, rate limits, database locks, telemetry and optional Turnstile.

## Local database commands

`pnpm supabase:setup` runs `supabase db reset --local`. It is intentionally destructive and must only be used for the local stack.

`pnpm supabase:migrate` runs a local dry-run followed by `supabase db push --local`. It applies pending local migrations without resetting existing local data.

Never alter these scripts to target a linked production project. Production changes remain behind the protected deployment workflow, migration guard, dry-run and pre/post integrity snapshots.

## Anti-cheat scope

Server-issued challenges, visual proof, wall-clock validation, one-time consumption, database locks, rate limits, competition scoping and Turnstile prevent basic request forgery and common automation paths. They cannot completely prevent a determined user from controlling a browser and reproducing a valid 10.6-second wait.

Do not attach monetary prizes to the current model without stronger identity, risk scoring, server-side telemetry and manual review.
