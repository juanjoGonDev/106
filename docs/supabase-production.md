# Supabase production deployment

## Required credentials

The production workflow requires these GitHub environment secrets:

- `SUPABASE_ACCESS_TOKEN`: personal Supabase access token beginning with `sbp_`.
- `SUPABASE_DB_PASSWORD`: PostgreSQL password used by Supabase CLI when linking and applying migrations.
- `HASH_PEPPER`: application hashing secret.

It also requires the repository variable `SUPABASE_PROJECT_ID`.

## Optional integrity connection

`SUPABASE_DB_URL` is an optional GitHub environment secret used only for direct `psql` integrity snapshots before and after a deployment. It is not used by the application and it is not required by `supabase db push` or Edge Function deployment.

For GitHub-hosted runners, copy the **Session pooler** URI from Supabase Dashboard → **Connect** and use port `5432`.

Example shape:

```text
postgresql://postgres.PROJECT_REF:ENCODED_PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres
```

Do not use the direct host below unless the runner has working IPv6 connectivity:

```text
postgresql://postgres:PASSWORD@db.PROJECT_REF.supabase.co:5432/postgres
```

The direct Supabase database hostname commonly resolves to IPv6. Standard GitHub-hosted runners may report `Network is unreachable` even though Supabase CLI can still link, migrate and deploy through its supported platform connection.

Encode reserved URL characters in the password before placing it in the URI. Store the complete URI only as a secret, never as a repository variable or committed file.

## Deployment behavior

The workflow performs a five-second connectivity probe before any direct snapshot operation.

- When the probe succeeds, pre/post counters and audit references are mandatory. Any snapshot or monotonicity failure stops the deployment.
- When the URL is missing, malformed or unreachable, the workflow emits a warning and skips only the direct snapshot layer.
- Migration guards, linked dry-run, incremental migrations, Edge Function secrets and Edge Function deployment continue normally.

A skipped snapshot is a degraded safety mode. Replace an unreachable direct URL with the Session pooler URI to restore the full integrity checks.

## Recovery after changing a secret

Changing a GitHub secret does not automatically start a workflow. Run:

1. GitHub → Actions.
2. **Deploy Supabase backend safely**.
3. **Run workflow**.
4. Select `main`.

After a successful run, verify the production Edge Function and CORS behavior from the public GitHub Pages origin.
