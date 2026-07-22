#!/usr/bin/env bash
set -Eeuo pipefail

exec > >(tee supabase-integration.log) 2>&1

FUNCTION_PID=''

cleanup() {
  exit_code=$?
  trap - EXIT INT TERM

  if [[ -n "$FUNCTION_PID" ]]; then
    kill "$FUNCTION_PID" 2>/dev/null || true
    wait "$FUNCTION_PID" 2>/dev/null || true
  fi

  supabase stop --no-backup >/dev/null 2>&1 || true
  rm -f supabase/functions/.env .supabase-functions.pid

  exit "$exit_code"
}
trap cleanup EXIT INT TERM

cat > supabase/functions/.env <<'EOF'
HASH_PEPPER=ci-local-only-pepper-106-do-not-use-in-production
ALLOWED_ORIGINS=http://127.0.0.1:3000,http://localhost:3000
TURNSTILE_SECRET_KEY=
EOF

echo '::group::Start local Supabase stack'
supabase start \
  -x studio,imgproxy,mailpit,realtime,storage-api,postgres-meta,logflare,vector,supavisor
echo '::endgroup::'

echo '::group::Serve all Edge Functions in the local runtime'
supabase functions serve \
  --env-file supabase/functions/.env \
  > supabase-functions.log 2>&1 &
FUNCTION_PID=$!
echo "$FUNCTION_PID" > .supabase-functions.pid
echo '::endgroup::'

echo '::group::Run complete API and persistence journey'
pnpm test:supabase
echo '::endgroup::'

echo '::group::Lint PostgreSQL functions and schema'
supabase db lint --level error
echo '::endgroup::'

echo '::group::Verify migration history'
supabase migration list --local
echo '::endgroup::'

echo '::group::Rebuild database entirely from migrations'
supabase db reset
echo '::endgroup::'

echo '::group::Re-run API smoke checks after database rebuild'
SUPABASE_SMOKE_ONLY=true pnpm test:supabase
echo '::endgroup::'

echo 'Local Supabase stack, Edge Functions, migrations and integration journey passed.'
