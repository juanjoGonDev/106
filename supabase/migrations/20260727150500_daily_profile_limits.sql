do $$
begin
  if to_regprocedure('public.get_game_player_profile_without_daily_limits(text)') is null then
    alter function public.get_game_player_profile(text)
      rename to get_game_player_profile_without_daily_limits;
  end if;
end;
$$;

create or replace function public.get_game_player_profile(p_nick_key text)
returns jsonb
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.get_game_player_profile_without_daily_limits(p_nick_key), '{}'::jsonb)
    || public.get_game_daily_attempt_state(p_nick_key, clock_timestamp());
$$;

do $$
begin
  if to_regprocedure('public.get_game_account_players_without_daily_limits(text)') is null then
    alter function public.get_game_account_players(text)
      rename to get_game_account_players_without_daily_limits;
  end if;
end;
$$;

create or replace function public.get_game_account_players(p_account_token_hash text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_base jsonb := public.get_game_account_players_without_daily_limits(p_account_token_hash);
  v_player jsonb;
  v_players jsonb := '[]'::jsonb;
  v_state jsonb;
begin
  for v_player in
    select value from jsonb_array_elements(coalesce(v_base->'players', '[]'::jsonb))
  loop
    v_state := public.get_game_daily_attempt_state(
      coalesce(nullif(v_player->>'nickKey', ''), lower(v_player->>'nick')),
      clock_timestamp()
    );
    v_players := v_players || jsonb_build_array(v_player || v_state);
  end loop;

  return jsonb_set(coalesce(v_base, '{}'::jsonb), '{players}', v_players, true);
end;
$$;

revoke all on function public.game_server_day(timestamptz) from public, anon, authenticated;
revoke all on function public.game_server_reset_at(date) from public, anon, authenticated;
revoke all on function public.daily_game_account_id(uuid) from public, anon, authenticated;
revoke all on function public.game_account_id_for_nick(text) from public, anon, authenticated;
revoke all on function public.game_account_completed_referrals(uuid) from public, anon, authenticated;
revoke all on function public.game_account_referral_bonus(uuid) from public, anon, authenticated;
revoke all on function public.game_player_daily_bonus(text) from public, anon, authenticated;
revoke all on function public.get_game_daily_attempt_state(text, timestamptz) from public, anon, authenticated;
revoke all on function public.register_game_account_referral(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.complete_game_account_referral(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.start_game_challenge(text, text, text, text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.start_game_challenge_pointer_only(text, text, text, text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.activate_game_challenge_pointer_only(uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.finish_game_attempt(uuid, integer, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.get_game_player_profile_without_daily_limits(text) from public, anon, authenticated, service_role;
revoke all on function public.get_game_player_profile(text) from public, anon, authenticated;
revoke all on function public.get_game_account_players_without_daily_limits(text) from public, anon, authenticated, service_role;
revoke all on function public.get_game_account_players(text) from public, anon, authenticated;

grant execute on function public.game_server_day(timestamptz) to service_role;
grant execute on function public.game_server_reset_at(date) to service_role;
grant execute on function public.daily_game_account_id(uuid) to service_role;
grant execute on function public.game_account_id_for_nick(text) to service_role;
grant execute on function public.game_account_completed_referrals(uuid) to service_role;
grant execute on function public.game_account_referral_bonus(uuid) to service_role;
grant execute on function public.game_player_daily_bonus(text) to service_role;
grant execute on function public.get_game_daily_attempt_state(text, timestamptz) to service_role;
grant execute on function public.register_game_account_referral(uuid, text, text, text) to service_role;
grant execute on function public.complete_game_account_referral(uuid, timestamptz) to service_role;
grant execute on function public.start_game_challenge(text, text, text, text, text, uuid, text) to service_role;
grant execute on function public.start_game_challenge_pointer_only(text, text, text, text, text, uuid, text) to service_role;
grant execute on function public.activate_game_challenge_pointer_only(uuid, text, text, integer) to service_role;
grant execute on function public.finish_game_attempt(uuid, integer, text, text, jsonb) to service_role;
grant execute on function public.get_game_player_profile(text) to service_role;
grant execute on function public.get_game_account_players(text) to service_role;
