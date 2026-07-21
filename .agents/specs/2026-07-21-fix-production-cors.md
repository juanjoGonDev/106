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
- Keep disallowed origins rejected; do not configure `*` in production.
- Add unit regressions for path normalization and a Supabase integration regression that performs a successful browser preflight and authorized POST while preserving rejection of an untrusted origin.

## Acceptance

- A browser preflight from an allowed origin returns an HTTP 2xx response with usable CORS headers through the Supabase gateway.
- A configured URL containing `/106/` normalizes to and authorizes `https://juanjogondev.github.io`.
- An untrusted origin still returns HTTP 403 on an Edge Function request.
- Production deployment always writes a canonical Pages origin to `ALLOWED_ORIGINS`.
- Unit, security, ESLint, Knip and Supabase integration checks pass.

## Validation

- Vitest covers explicit origin normalization, deduplication, invalid protocol rejection and workflow wiring.
- Local Supabase CLI starts PostgreSQL, Kong and the Edge Runtime, then executes a real `OPTIONS` preflight and permitted/forbidden origin requests.
- The complete API and persistence journey passes before and after rebuilding the local database from migrations.
- Pull Request Quality Pipeline run `29854482184` completed successfully, including `✅ Quality Gate · Ready to merge`.

## Delivery

- Branch: `agent/fix-production-cors`.
- Pull request: `#3` to `main`.
- Production deployment intentionally not executed before merge approval.

## Status

Complete and ready for review. Production remains unchanged until PR #3 is merged and the protected Supabase deployment succeeds.
