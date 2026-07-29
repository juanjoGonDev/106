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

readonly VALID_SUITES='security ready-flow gameplay-core gameplay-sharing auth-api auth-browser migrations'
readonly EDGE_WARMUP_ATTEMPTS=3
readonly EDGE_WARMUP_TIMEOUT_SECONDS=30

cleanup() {
  exit_code=$?
  trap - EXIT INT TERM

  if [[ -n "$FUNCTION_PID" ]]; then
    kill "$FUNCTION_PID" 2>/dev/null || true
    wait "$FUNCTION_PID" 2>/dev/null || true
  fi

  if [[ "${GITHUB_ACTIONS:-false}" != 'true' ]]; then
    supabase stop --no-backup >/dev/null 2>&1 || true
  fi
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

clear_stale_ci_supabase_containers() {
  if [[ "${GITHUB_ACTIONS:-false}" != 'true' ]]; then
    return 0
  fi

  local stale_containers=()
  mapfile -t stale_containers < <(docker ps --all --quiet --filter 'name=supabase_')
  if (( ${#stale_containers[@]} == 0 )); then
    return 0
  fi

  docker rm --force "${stale_containers[@]}" >/dev/null
  echo "✓ removed ${#stale_containers[@]} stale Supabase runner container(s)"
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
  local status

  if ! status=$(curl --silent --show-error \
    --connect-timeout 2 \
    --max-time "$EDGE_WARMUP_TIMEOUT_SECONDS" \
    --output /dev/null \
    --write-out '%{http_code}' \
    --request POST \
    --header 'content-type: application/json' \
    --header 'origin: http://127.0.0.1:3000' \
    --data "$payload" \
    "$endpoint"); then
    return 1
  fi

  [[ "$status" -ge 200 && "$status" -lt 500 ]]
}

warm_auth_api_functions() {
  local account_auth_pid game_api_pid failed=0

  probe_edge_function "$API_URL/functions/v1/account-auth" '{"action":"session"}' &
  account_auth_pid=$!
  probe_edge_function "$API_URL/functions/v1/game-api" '{"action":"stats"}' &
  game_api_pid=$!

  wait "$account_auth_pid" || failed=1
  wait "$game_api_pid" || failed=1
  return "$failed"
}

warm_edge_functions_for_suite() {
  case "$SUITE" in
    auth-api)
      warm_auth_api_functions
      ;;
    auth-browser)
      probe_edge_function "$API_URL/functions/v1/account-auth" '{"action":"session"}'
      ;;
    ready-flow)
      probe_edge_function "$API_URL/functions/v1/game-ready-api" '{"action":"health"}'
      ;;
    gameplay-core)
      probe_edge_function "$API_URL/functions/v1/game-api" '{"action":"stats"}' \
        && probe_edge_function "$API_URL/functions/v1/game-ready-api" '{"action":"health"}'
      ;;
    security)
      probe_edge_function "$API_URL/functions/v1/game-api" '{"action":"stats"}' \
        && probe_edge_function "$API_URL/functions/v1/player-context" '{"action":"player-context","nick":"Warmup106"}' \
        && probe_edge_function "$API_URL/functions/v1/league-api" '{"action":"list-leagues","search":"","visibility":"all"}'
      ;;
    gameplay-sharing|migrations)
      probe_edge_function "$API_URL/functions/v1/game-api" '{"action":"stats"}'
      ;;
  esac
}

wait_for_edge_functions() {
  load_local_supabase_environment

  local attempt
  for attempt in $(seq 1 "$EDGE_WARMUP_ATTEMPTS"); do
    if [[ -n "$FUNCTION_PID" ]] && ! kill -0 "$FUNCTION_PID" 2>/dev/null; then
      echo "The local Edge Function runtime for ${SUITE} exited before becoming ready." >&2
      cat supabase-functions.log >&2 || true
      return 1
    fi

    if warm_edge_functions_for_suite; then
      echo "✓ ${SUITE} Edge Functions are warm after ${attempt} probe(s)"
      return 0
    fi
    sleep 1
  done

  echo "Local Edge Functions for ${SUITE} did not become ready after ${EDGE_WARMUP_ATTEMPTS} bounded probes." >&2
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

run_ready_flow_suite() {
  node scripts/test-ready-flow-local.mjs
}

run_gameplay_core_suite() {
  node scripts/test-supabase-local.mjs
  node scripts/test-attempt-reservations-local.mjs
  node scripts/test-daily-attempt-limits-local.mjs
  node scripts/test-verified-email-daily-bonus-local.mjs
  node scripts/test-mobile-touch-local.mjs
}

run_gameplay_sharing_suite() {
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
clear_stale_ci_supabase_containers

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

echo "::group::Serve Edge Functions for ${SUITE}"
supabase functions serve \
  --env-file supabase/functions/.env \
  > supabase-functions.log 2>&1 &
FUNCTION_PID=$!
echo "$FUNCTION_PID" > .supabase-functions.pid
if [[ "$SUITE" == 'migrations' ]]; then
  echo '✓ migrations defers Edge Function warm-up until after database reset'
else
  wait_for_edge_functions
fi
echo '::endgroup::'

echo "::group::Run Supabase ${SUITE} suite"
case "$SUITE" in
  security)
    run_security_suite
    ;;
  ready-flow)
    run_ready_flow_suite
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
