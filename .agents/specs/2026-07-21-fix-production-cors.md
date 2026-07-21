# Production CORS fix

## Request

Restore browser access from GitHub Pages to the deployed Supabase `game-api` Edge Function.

## Evidence

- Browser origin is `https://juanjogondev.github.io`; URL paths such as `/106/` are not part of the HTTP `Origin` header.
- The Edge Function replaces its default allowlist whenever `ALLOWED_ORIGINS` exists and compares values literally.
- A configured value such as `https://juanjogondev.github.io/106/` therefore rejects the valid Pages origin during `OPTIONS` with HTTP 403.

## Decision

- Normalize every configured HTTP(S) URL to `URL.origin`.
- Always retain the explicit local development origins and the canonical GitHub Pages origin.
- Generate the production `ALLOWED_ORIGINS` secret from the repository owner, optional public site URL, and optional additional origins.
- Keep disallowed origins rejected; do not use `*`.
- Add an integration regression that serves the function with a path-bearing allowlist and verifies a successful GitHub Pages preflight.

## Acceptance

- `OPTIONS` from `https://juanjogondev.github.io` returns 204 and the matching `Access-Control-Allow-Origin` header.
- A configured URL containing `/106/` authorizes its origin correctly.
- An untrusted origin still returns 403.
- Production deployment always writes a canonical Pages origin to `ALLOWED_ORIGINS`.
- Unit/security/Supabase integration checks pass.

## Validation

- Vitest regression for source/config policy.
- Local Supabase CLI stack and real Edge Function preflight.
- Existing complete API and persistence journey.

## Delivery

Branch `agent/fix-production-cors`, normal PR to `main`; no direct production merge or deployment.

## Status

In progress.
