#!/usr/bin/env bash
set -Eeuo pipefail

exec > >(tee supabase-integration.log) 2>&1

SUITE=${1:-${SUPABASE_CI_SUITE:-}}
FUNCTION_PID=''
API_URL=''
ANON_KEY=''
SERVICE_ROLE_KEY=''
DB_URL=''
POSTGRES_URL=''

readonly VALID_SUITES='security gameplay-core gameplay-sharing auth-api auth-browser migrations'

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

validate_suite() {
  if [[ -z "$SUITE" || " $VALID_SUITES " != *" $SUITE "* ]]; then
    echo "Expected one Supabase CI suite: $VALID_SUITES. Received: ${SUITE:-<empty>}" >&2
    return 1
  fi
}

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
  for attempt in $(seq 1 45); do
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

  echo 'Local Auth did not become database-ready within 45 seconds.' >&2
  return 1
}

probe_edge_function() {
  local endpoint=$1
  local payload=$2
  curl --silent --show-error --fail --max-time 5 \
    --request POST \
    --header 'content-type: application/json' \
    --header 'origin: http://127.0.0.1:3000' \
    --data "$payload" \
    "$endpoint" \
    >/dev/null
}

wait_for_edge_functions() {
  load_local_supabase_environment

  local attempt
  for attempt in $(seq 1 30); do
    if [[ -n "$FUNCTION_PID" ]] && ! kill -0 "$FUNCTION_PID" 2>/dev/null; then
      echo 'The local Edge Function runtime exited before becoming ready.' >&2
      cat supabase-functions.log >&2 || true
      return 1
    fi

    if probe_edge_function "$API_URL/functions/v1/game-api" '{"action":"stats"}' \
      && probe_edge_function "$API_URL/functions/v1/player-context" '{"action":"player-context","nick":"Warmup106"}' \
      && probe_edge_function "$API_URL/functions/v1/league-api" '{"action":"list-leagues","search":"","visibility":"all"}'; then
      echo "✓ game, player-context and league Edge Functions are warm after ${attempt} probe(s)"
      return 0
    fi
    sleep 1
  done

  echo 'Local Edge Functions did not become ready within 30 seconds.' >&2
  cat supabase-functions.log >&2 || true
  return 1
}

run_security_suite() {
  node scripts/test-database-permissions-local.mjs
  node scripts/test-input-security-local.mjs
  node scripts/test-migration-compatibility-local.mjs
  supabase db lint --level error
  supabase migration list --local
}

run_gameplay_core_suite() {
  node scripts/test-supabase-local.mjs
  node scripts/test-attempt-reservations-local.mjs
  node scripts/test-daily-attempt-limits-local.mjs
  node scripts/test-verified-email-daily-bonus-local.mjs
  node scripts/test-mobile-touch-local.mjs
}

run_gameplay_sharing_suite() {
  node scripts/test-ready-flow-local.mjs
  node scripts/test-trophies-local.mjs
  node scripts/test-player-share-local.mjs
  node scripts/test-social-share-local.mjs
}

run_auth_api_suite() {
  node scripts/test-account-auth-local.mjs
  node scripts/test-verified-email-reward-local.mjs
  node scripts/test-account-auth-concurrency-local.mjs
}

run_auth_browser_suite() {
  load_local_supabase_environment
  export SUPABASE_AUTH_LIVE=1
  export SUPABASE_TEST_URL="$API_URL"
  export SUPABASE_TEST_ANON_KEY="$ANON_KEY"
  export SUPABASE_TEST_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"
  export SUPABASE_TEST_DB_URL="${DB_URL:-$POSTGRES_URL}"
  export PLAYWRIGHT_WEB_SERVER_COMMAND='node scripts/serve.mjs'
  node scripts/run-playwright.mjs --grep @live-auth --project=desktop-chrome
}

run_migration_suite() {
  supabase db reset
  wait_for_auth_database
  wait_for_edge_functions
  node scripts/wait-for-postgrest-local.mjs
}

validate_suite

cat > supabase/functions/.env <<'EOF'
HASH_PEPPER=ci-local-only-pepper-106-do-not-use-in-production
ALLOWED_ORIGINS=http://127.0.0.1:3000,http://localhost:3000
TURNSTILE_SECRET_KEY=
EOF

echo "::group::Start local Supabase stack for ${SUITE}"
supabase start \
  -x studio,imgproxy,realtime,storage-api,postgres-meta,logflare,vector,supavisor
wait_for_auth_database
echo '::endgroup::'

echo "::group::Serve and warm Edge Functions for ${SUITE}"
supabase functions serve \
  --env-file supabase/functions/.env \
  > supabase-functions.log 2>&1 &
FUNCTION_PID=$!
echo "$FUNCTION_PID" > .supabase-functions.pid
wait_for_edge_functions
echo '::endgroup::'

echo "::group::Run Supabase ${SUITE} suite"
case "$SUITE" in
  security)
    run_security_suite
    ;;
  gameplay-core)
    run_gameplay_core_suite
    ;;
  gameplay-sharing)
    run_gameplay_sharing_suite
    ;;
  auth-api)
    run_auth_api_suite
    ;;
  auth-browser)
    run_auth_browser_suite
    ;;
  migrations)
    run_migration_suite
    ;;
esac
echo '::endgroup::'

echo "Supabase ${SUITE} suite passed."
