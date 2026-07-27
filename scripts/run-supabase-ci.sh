#!/usr/bin/env bash
set -Eeuo pipefail

exec > >(tee supabase-integration.log) 2>&1

FUNCTION_PID=''
API_URL=''
ANON_KEY=''
SERVICE_ROLE_KEY=''
DB_URL=''
POSTGRES_URL=''

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

load_local_supabase_environment() {
  local key raw value
  while IFS='=' read -r key raw; do
    case "$key" in
      API_URL|ANON_KEY|SERVICE_ROLE_KEY|DB_URL|POSTGRES_URL)
        value="${raw#\"}"
        value="${value%\"}"
        printf -v "$key" '%s' "$value"
        ;;
    esac
  done < <(supabase status -o env)

  if [[ -z "$API_URL" || -z "$ANON_KEY" || -z "$SERVICE_ROLE_KEY" || -z "${DB_URL:-${POSTGRES_URL:-}}" ]]; then
    echo 'Local Supabase environment is incomplete.' >&2
    return 1
  fi
}

wait_for_auth_database() {
  load_local_supabase_environment

  local attempt
  for attempt in $(seq 1 60); do
    if curl --silent --show-error --fail --max-time 3 \
      --header "apikey: $SERVICE_ROLE_KEY" \
      --header "authorization: Bearer $SERVICE_ROLE_KEY" \
      "$API_URL/auth/v1/admin/users?page=1&per_page=1" \
      >/dev/null; then
      echo "✓ local Auth database is ready after ${attempt} probe(s)"
      return 0
    fi
    sleep 1
  done

  echo 'Local Auth did not become database-ready within 60 seconds.' >&2
  return 1
}

run_auth_integration() {
  node scripts/test-account-auth-local.mjs
  node scripts/test-verified-email-reward-local.mjs
  node scripts/test-account-auth-concurrency-local.mjs
}

run_live_auth_playwright() {
  load_local_supabase_environment
  export SUPABASE_AUTH_LIVE=1
  export SUPABASE_TEST_URL="$API_URL"
  export SUPABASE_TEST_ANON_KEY="$ANON_KEY"
  export SUPABASE_TEST_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"
  export SUPABASE_TEST_DB_URL="${DB_URL:-$POSTGRES_URL}"
  node scripts/run-playwright.mjs --grep @live-auth --project=desktop-chrome
}

cat > supabase/functions/.env <<'EOF'
HASH_PEPPER=ci-local-only-pepper-106-do-not-use-in-production
ALLOWED_ORIGINS=http://127.0.0.1:3000,http://localhost:3000
TURNSTILE_SECRET_KEY=
EOF

echo '::group::Start local Supabase stack'
supabase start \
  -x studio,imgproxy,realtime,storage-api,postgres-meta,logflare,vector,supavisor
wait_for_auth_database
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
run_auth_integration
echo '::endgroup::'

echo '::group::Run real browser authentication journeys'
run_live_auth_playwright
echo '::endgroup::'

echo '::group::Lint PostgreSQL functions and schema'
supabase db lint --level error
echo '::endgroup::'

echo '::group::Verify migration history'
supabase migration list --local
echo '::endgroup::'

echo '::group::Rebuild database entirely from migrations'
supabase db reset
wait_for_auth_database
echo '::endgroup::'

echo '::group::Re-run API smoke checks after database rebuild'
SUPABASE_SMOKE_ONLY=true pnpm test:supabase
node scripts/test-account-auth-local.mjs
echo '::endgroup::'

echo 'Local Supabase stack, Edge Functions, migrations, browser authentication and integration journey passed.'
