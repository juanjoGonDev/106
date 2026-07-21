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

## Anti-cheat scope

Server-issued challenges, wall-clock validation, one-time consumption, database locks, rate limits and optional Turnstile prevent basic request forgery and direct database manipulation. They cannot completely prevent a determined user from automating a real 10.6-second wait.

Do not attach monetary prizes to the current model without stronger identity, risk scoring, server-side telemetry and manual review.
