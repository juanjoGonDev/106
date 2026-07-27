# Authentication CI assertions

`pnpm test:supabase` is the authoritative local integration boundary for authenticated accounts. It verifies the schema from an empty database, real local Auth users and JWTs, account recovery, merge confirmation/cancellation/staleness, and direct PostgREST denial for `anon` and `authenticated`.

The complete setup and operation guide remains in `docs/authentication-and-account-linking.md`.
