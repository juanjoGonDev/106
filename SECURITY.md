# Security policy

## Secret handling

Never commit or expose:

- Supabase secret or `service_role` key
- Supabase personal access token
- PostgreSQL password or connection string
- `HASH_PEPPER`
- Cloudflare Turnstile secret key
- Registry credentials or authentication tokens in `.npmrc`, `pnpm-workspace.yaml` or the lockfile

The browser may receive only the Edge Function URL and the Turnstile site key. Both are public identifiers, not credentials.

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

The frontend must not access `game_challenges` or `game_attempts` through the Supabase Data API. RLS is enabled and database grants are revoked for `anon` and `authenticated`. All writes go through `game-api` and private RPC functions executed with `service_role`.

## CORS origin policy

The Edge Function uses an explicit origin allowlist and never uses `Access-Control-Allow-Origin: *`.

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

## Local database commands

`pnpm supabase:setup` runs `supabase db reset --local`. It is intentionally destructive and must only be used for the local stack.

`pnpm supabase:migrate` runs a local dry-run followed by `supabase db push --local`. It applies pending local migrations without resetting existing local data.

Never alter these scripts to target a linked production project. Production changes remain behind the protected deployment workflow, migration guard, dry-run and pre/post integrity snapshots.

## Anti-cheat scope

Server-issued challenges, wall-clock validation, one-time consumption, database locks, rate limits, competition scoping and optional Turnstile prevent basic request forgery and direct database manipulation. They cannot completely prevent a determined user from automating a real 10.6-second wait.

Do not attach monetary prizes to the current model without stronger identity, risk scoring, server-side telemetry and manual review.
