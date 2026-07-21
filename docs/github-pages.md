# GitHub Pages deployment

Minuto 106 supports both GitHub Pages publishing modes without duplicating the application source.

## Repository variables

Configure these public values under **Settings → Secrets and variables → Actions → Variables**:

| Variable | Required | Purpose |
|---|---:|---|
| `SUPABASE_PROJECT_ID` | Yes, unless `SUPABASE_FUNCTIONS_URL` is set | Supabase project reference used to derive the Edge Function URL. |
| `SUPABASE_FUNCTIONS_URL` | No | Explicit override for the complete `game-api` URL. |
| `PUBLIC_SITE_URL` | No | Explicit override for a custom domain. GitHub Pages supplies its own URL automatically otherwise. |
| `TURNSTILE_SITE_KEY` | No | Public Cloudflare Turnstile site key. |
| `GOOGLE_ANALYTICS_ID` | No | Public Google Analytics identifier. |
| `ADSENSE_CLIENT` | No | Public AdSense client identifier. |

The generated API endpoint is:

```text
https://<SUPABASE_PROJECT_ID>.supabase.co/functions/v1/game-api
```

Do not store service-role keys, database credentials, `HASH_PEPPER` or Turnstile secrets in repository variables or public files.

## Publishing from `main/(root)`

When Pages is configured to deploy from `main` and `/(root)`:

1. The root `index.html` routes visitors to the canonical application under `public/`.
2. `.github/workflows/pages.yml` detects the legacy branch publishing mode.
3. The workflow generates `public/config.js` from repository variables.
4. Only that public generated file is committed by `github-actions[bot]` when it changed.
5. The workflow requests a new Pages build through the GitHub Pages API.

No manual copy of `public/` is required.

## Publishing with GitHub Actions

When Pages uses **GitHub Actions** as its source:

1. The same workflow detects `build_type=workflow`.
2. It generates and validates `public/config.js`.
3. It uploads `public/` as the Pages artifact.
4. `actions/deploy-pages` publishes the artifact.

The repository therefore remains compatible with either Pages setting.

## Failure behavior

The deployment fails before publishing when neither `SUPABASE_FUNCTIONS_URL` nor a valid `SUPABASE_PROJECT_ID` is available. It also fails when GitHub does not provide a valid public Pages URL. This prevents publishing a site that displays the placeholder configuration warning.

The runtime values embedded in `public/config.js` are public identifiers. Production secrets remain in the Supabase deployment workflow and are never written to the Pages artifact.
