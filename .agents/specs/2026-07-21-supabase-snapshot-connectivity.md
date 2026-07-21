# Supabase snapshot connectivity recovery

## Request

Restore the production Supabase deployment after the optional PostgreSQL snapshot connection failed with `Network is unreachable` on a GitHub-hosted runner.

## Evidence

- The failing host was `db.imtitjwgiemlaabpioed.supabase.co:5432`.
- The runner resolved the host to IPv6 and could not establish a network connection.
- CORS repair and Supabase CLI authentication had already progressed further than previous failed runs.
- `SUPABASE_DB_URL` is used only by direct `psql` snapshot and audit steps; linked migration and Edge Function deployment use Supabase CLI.

## Decision

- Probe the optional snapshot connection before running any direct `psql` operation.
- Use a short connection timeout and pass the URI through `PGDATABASE`, avoiding command-line exposure.
- When the connection is absent, malformed or unreachable, skip only snapshot and audit-reference steps with an explicit warning.
- Continue to fail when a reachable snapshot connection produces a query, comparison or monotonicity error.
- Recommend the Supabase Session pooler URI on port 5432 for GitHub-hosted runners.

## Acceptance

- A direct IPv6-only Supabase URL no longer blocks migrations or Edge Function deployment.
- A reachable Session pooler URL enables all pre/post integrity checks.
- No database credential is printed in workflow logs.
- Every direct snapshot and audit step is gated by the connectivity probe output.
- Unit tests cover direct-host detection, pooler detection, successful connectivity and degraded fallback.
- Documentation explains the correct secret type and connection mode.

## Validation

- `pnpm check:syntax`
- `pnpm lint`
- `pnpm knip`
- `pnpm test`
- Pull Request Quality Pipeline
- Production workflow execution after merge remains the authoritative remote deployment validation.

## Rollback

Revert the pull request. No database schema or application data is changed by this workflow-only recovery.

## Delivery

Branch `agent/fix-supabase-snapshot-connectivity`; normal pull request to `main`; no direct production mutation.

## Status

In progress.
