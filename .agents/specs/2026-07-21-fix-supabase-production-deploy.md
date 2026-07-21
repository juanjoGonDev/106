# Supabase production deploy recovery

## Request

Restore the production Supabase deployment and remove the CORS outage affecting GitHub Pages.

## Evidence

- Production runs `29847845707` and `29855348794` failed in `Validate deployment configuration` before Supabase CLI setup.
- `SUPABASE_DB_URL` was empty in both runs.
- `ALLOWED_ORIGINS` was configured as `*`.
- Because validation failed before `supabase secrets set` and `supabase functions deploy`, the deployed Edge Function retained its previous CORS configuration.

## Decision

- Keep `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_ID` and `HASH_PEPPER` mandatory.
- Treat `SUPABASE_DB_URL` as an optional enhanced integrity control. When absent, skip only direct `psql` snapshots and emit an explicit degraded-safety warning.
- Continue to protect migrations with the destructive-operation guard, linked dry-run and incremental `db push`.
- Ignore a legacy CORS wildcard rather than deploying it.
- Always derive the canonical GitHub Pages origin from `github.repository_owner`.
- Repair the CORS secret before migration work, then deploy the current function only after migrations succeed.
- Pin every action used by the modified production workflow to a full commit SHA.

## Acceptance

- A missing `SUPABASE_DB_URL` does not stop migrations or Edge Function deployment.
- Missing mandatory deployment credentials still fail before remote changes.
- `ALLOWED_ORIGINS=*` never produces a wildcard deployment.
- The generated allowlist contains `https://juanjogondev.github.io`.
- CORS repair runs before migration preview/application.
- Snapshot and audit steps run only when `SUPABASE_DB_URL` exists.
- Unit, lint, security, Knip and local Supabase integration jobs pass.
- A normal pull request is open and mergeable.

## Validation

- Pull Request Quality Pipeline run `29856620645` passed.
- Build, Vitest, ESLint, Knip and dependency/security checks passed.
- Local Supabase CLI stack, full migration rebuild, Edge Function and API journey passed.
- Quality Gate completed successfully.
- Production workflow execution after merge remains the authoritative remote deployment validation.

## Rollback

Revert the pull request. The change does not mutate application data by itself. A merge starts the existing incremental production migration and Edge Function deployment workflow.

## Delivery

Branch `agent/fix-supabase-production-deploy`; normal PR `#4` to `main`; no direct merge or manual production mutation.

## Status

Ready for merge. Production remains unchanged until PR `#4` is merged and the Supabase production workflow completes.
