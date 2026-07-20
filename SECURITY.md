# Security policy

## Secret handling

Never commit or expose:

- Supabase secret or `service_role` key
- Supabase personal access token
- PostgreSQL password or connection string
- `HASH_PEPPER`
- Cloudflare Turnstile secret key

The browser may receive only the Edge Function URL and the Turnstile site key. Both are public identifiers, not credentials.

## Data access

The frontend must not access `game_challenges` or `game_attempts` through the Supabase Data API. RLS is enabled and database grants are revoked for `anon` and `authenticated`. All writes go through `game-api` and private RPC functions executed with `service_role`.

## Anti-cheat scope

Server-issued challenges, wall-clock validation, one-time consumption, database locks, rate limits and optional Turnstile prevent basic request forgery and direct database manipulation. They cannot completely prevent a determined user from automating a real 10.6-second wait.

Do not attach monetary prizes to the current model without stronger identity, risk scoring, server-side telemetry and manual review.
