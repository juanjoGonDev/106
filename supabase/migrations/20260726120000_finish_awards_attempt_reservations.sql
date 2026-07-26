create index if not exists game_challenges_active_budget_idx
  on public.game_challenges(nick_key, league_id, expires_at)
  where consumed_at is null;

alter function public.get_game_stats()
  rename to get_game_stats_without_daily_awards;

create function public.get_game_stats()
returns jsonb
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.get_game_stats_without_daily_awards(), '{}'::jsonb)
    || jsonb_build_object('awards', public.get_game_daily_awards());
$$;

alter function public.start_game_challenge_pointer_only(
  text,
  text,
  text,
  text,
  text,
  uuid,
  text
) rename to start_game_challenge_pointer_only_without_reservations;

create function public.start_game_challenge_pointer_only(
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
  v_challenge public.game_challenges%rowtype;
  v_completed_attempts integer := 0;
  v_active_challenges integer := 0;
  v_bonus_attempts integer := 0;
  v_max_attempts integer := 5;
  v_attempts_left integer := 0;
begin
  v_result := public.start_game_challenge_pointer_only_without_reservations(
    p_nick,
    p_nick_key,
    p_team,
    p_device_hash,
    p_ip_hash,
    p_referral_code,
    p_league_code
  );

  if v_result ? 'error' then
    return v_result;
  end if;

  if nullif(v_result->>'challengeId', '') is null then
    return jsonb_build_object('error', 'invalid_input');
  end if;

  select * into v_challenge
  from public.game_challenges
  where id = (v_result->>'challengeId')::uuid
  for update;

  if not found then
    return jsonb_build_object('error', 'challenge_not_found');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    v_challenge.nick_key || ':' || coalesce(v_challenge.league_id::text, 'global'),
    106
  ));

  select count(*)::integer into v_completed_attempts
  from public.game_attempts attempt
  where attempt.nick_key = v_challenge.nick_key
    and attempt.league_id is not distinct from v_challenge.league_id;

  select count(*)::integer into v_active_challenges
  from public.game_challenges challenge
  where challenge.nick_key = v_challenge.nick_key
    and challenge.league_id is not distinct from v_challenge.league_id
    and challenge.consumed_at is null
    and challenge.expires_at > clock_timestamp();

  if v_challenge.league_id is null then
    select coalesce((
      select bonus.bonus_attempts
      from public.game_player_bonus bonus
      where bonus.nick_key = v_challenge.nick_key
    ), 0) into v_bonus_attempts;
  end if;

  v_max_attempts := 5 + v_bonus_attempts;

  if v_completed_attempts + v_active_challenges > v_max_attempts then
    delete from public.game_challenges where id = v_challenge.id;
    v_attempts_left := greatest(
      0,
      v_max_attempts - v_completed_attempts - (v_active_challenges - 1)
    );
    return jsonb_build_object(
      'error', 'nick_limit',
      'attemptsLeft', v_attempts_left,
      'maxAttempts', v_max_attempts
    );
  end if;

  v_attempts_left := greatest(
    0,
    v_max_attempts - v_completed_attempts - v_active_challenges
  );

  return v_result || jsonb_build_object(
    'attemptsLeft', v_attempts_left,
    'maxAttempts', v_max_attempts
  );
end;
$$;

revoke all on function public.get_game_stats_without_daily_awards()
  from public, anon, authenticated, service_role;
revoke all on function public.get_game_stats()
  from public, anon, authenticated;
revoke all on function public.start_game_challenge_pointer_only_without_reservations(
  text,
  text,
  text,
  text,
  text,
  uuid,
  text
) from public, anon, authenticated, service_role;
revoke all on function public.start_game_challenge_pointer_only(
  text,
  text,
  text,
  text,
  text,
  uuid,
  text
) from public, anon, authenticated;

grant execute on function public.get_game_stats() to service_role;
grant execute on function public.start_game_challenge_pointer_only(
  text,
  text,
  text,
  text,
  text,
  uuid,
  text
) to service_role;
