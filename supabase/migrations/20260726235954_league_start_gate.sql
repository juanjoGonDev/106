create or replace function public.start_game_challenge_pointer_only_without_reservations(
  p_nick text,
  p_nick_key text,
  p_team text,
  p_device_hash text,
  p_ip_hash text,
  p_referral_code uuid default null,
  p_league_code text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_challenge_id uuid;
  v_league public.game_leagues%rowtype;
begin
  if nullif(trim(coalesce(p_league_code, '')), '') is not null then
    select * into v_league
    from public.game_leagues
    where code = upper(trim(p_league_code));

    if not found then return jsonb_build_object('error', 'league_not_found'); end if;
    if v_league.activated_at is null then
      return jsonb_build_object('error', 'league_waiting')
        || public.get_game_league_status(v_league.id);
    end if;
    if v_league.starts_at > clock_timestamp() then
      return jsonb_build_object('error', 'league_scheduled')
        || public.get_game_league_status(v_league.id);
    end if;
    if v_league.ends_at <= clock_timestamp() then
      return jsonb_build_object('error', 'league_finished');
    end if;
  end if;

  v_result := public.start_game_challenge(
    p_nick,
    p_nick_key,
    p_team,
    p_device_hash,
    p_ip_hash,
    p_referral_code,
    p_league_code
  );

  if v_result ? 'error' then return v_result; end if;

  v_challenge_id := (v_result->>'challengeId')::uuid;
  update public.game_challenges
  set interaction_mode = 'press',
      min_hold_ms = 0,
      max_hold_ms = 0
  where id = v_challenge_id;

  v_result := jsonb_set(v_result, '{interaction,mode}', to_jsonb('press'::text), true);
  v_result := v_result #- '{interaction,keyboardKey}' #- '{interaction,minHoldMs}' #- '{interaction,maxHoldMs}';
  return v_result;
end;
$$;

revoke all on function public.get_game_league_status(uuid) from public, anon, authenticated;
revoke all on function public.activate_game_league_if_eligible(uuid) from public, anon, authenticated;
revoke all on function public.create_game_league(text, text, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.create_game_league(text, text, text) from public, anon, authenticated;
revoke all on function public.join_game_league(text, text, text, text) from public, anon, authenticated;
revoke all on function public.join_game_league(text, text, text) from public, anon, authenticated;
revoke all on function public.join_game_league(text, text) from public, anon, authenticated;
revoke all on function public.list_game_leagues(text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.get_game_public_league(text) from public, anon, authenticated;
revoke all on function public.get_game_league_player_status(text, text) from public, anon, authenticated;
revoke all on function public.get_game_player_league_competition_code(text, text) from public, anon, authenticated;
revoke all on function public.get_game_player_leagues(text) from public, anon, authenticated;
revoke all on function public.start_game_challenge_pointer_only_without_reservations(text, text, text, text, text, uuid, text) from public, anon, authenticated;

grant execute on function public.get_game_league_status(uuid) to service_role;
grant execute on function public.activate_game_league_if_eligible(uuid) to service_role;
grant execute on function public.create_game_league(text, text, text, text, integer, integer) to service_role;
grant execute on function public.create_game_league(text, text, text) to service_role;
grant execute on function public.join_game_league(text, text, text, text) to service_role;
grant execute on function public.join_game_league(text, text, text) to service_role;
grant execute on function public.join_game_league(text, text) to service_role;
grant execute on function public.list_game_leagues(text, text, integer, integer) to service_role;
grant execute on function public.get_game_public_league(text) to service_role;
grant execute on function public.get_game_league_player_status(text, text) to service_role;
grant execute on function public.get_game_player_league_competition_code(text, text) to service_role;
grant execute on function public.get_game_player_leagues(text) to service_role;
grant execute on function public.start_game_challenge_pointer_only_without_reservations(text, text, text, text, text, uuid, text) to service_role;
