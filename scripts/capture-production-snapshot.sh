#!/usr/bin/env bash
set -euo pipefail

output_path="${1:?Usage: capture-production-snapshot.sh <output.json>}"
: "${SUPABASE_DB_URL:?SUPABASE_DB_URL is required}"

psql_value() {
  psql "$SUPABASE_DB_URL" --no-psqlrc --tuples-only --no-align --set ON_ERROR_STOP=1 --command "$1" | tr -d '\r\n'
}

table_exists() {
  local table="$1"
  [[ "$(psql_value "select to_regclass('public.${table}') is not null;")" == "t" ]]
}

count_table() {
  local table="$1"
  if table_exists "$table"; then
    psql_value "select count(*) from public.${table};"
  else
    echo 0
  fi
}

count_where() {
  local table="$1"
  local predicate="$2"
  if table_exists "$table"; then
    psql_value "select count(*) from public.${table} where ${predicate};"
  else
    echo 0
  fi
}

sum_column() {
  local table="$1"
  local column="$2"
  if table_exists "$table"; then
    psql_value "select coalesce(sum(${column}), 0) from public.${table};"
  else
    echo 0
  fi
}

attempts="$(count_table game_attempts)"
verified_attempts="$(count_where game_attempts 'verified = true')"
players="$(count_table game_players)"
referrals="$(count_table game_referrals)"
completed_referrals="$(count_where game_referrals 'completed_at is not null')"
bonus_attempts="$(sum_column game_player_bonus bonus_attempts)"
duels="$(count_table game_duels)"
completed_duels="$(count_where game_duels "status in ('won','lost')")"
leagues="$(count_table game_leagues)"
league_members="$(count_table game_league_members)"
accounts="$(count_table game_accounts)"
account_players="$(count_table game_account_players)"

mkdir -p "$(dirname "$output_path")"
jq -n \
  --arg capturedAt "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" \
  --argjson attempts "$attempts" \
  --argjson verifiedAttempts "$verified_attempts" \
  --argjson players "$players" \
  --argjson referrals "$referrals" \
  --argjson completedReferrals "$completed_referrals" \
  --argjson bonusAttempts "$bonus_attempts" \
  --argjson duels "$duels" \
  --argjson completedDuels "$completed_duels" \
  --argjson leagues "$leagues" \
  --argjson leagueMembers "$league_members" \
  --argjson accounts "$accounts" \
  --argjson accountPlayers "$account_players" \
  '{capturedAt: $capturedAt, attempts: $attempts, verifiedAttempts: $verifiedAttempts, players: $players, referrals: $referrals, completedReferrals: $completedReferrals, bonusAttempts: $bonusAttempts, duels: $duels, completedDuels: $completedDuels, leagues: $leagues, leagueMembers: $leagueMembers, accounts: $accounts, accountPlayers: $accountPlayers}' \
  > "$output_path"

cat "$output_path"