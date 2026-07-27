create or replace function public.start_game_challenge_pointer_only(
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
  v_is_global boolean;
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

  if v_result ? 'error' then return v_result; end if;
  if nullif(v_result->>'challengeId', '') is null then
    return jsonb_build_object('error', 'invalid_input');
  end if;

  select * into v_challenge
  from public.game_challenges
  where id = (v_result->>'challengeId')::uuid
  for update;

  if not found then return jsonb_build_object('error', 'challenge_not_found'); end if;
  v_is_global := v_challenge.league_id is null;

  perform pg_advisory_xact_lock(hashtextextended(
    v_challenge.nick_key || ':' || coalesce(v_challenge.league_id::text, 'global'),
    106
  ));

  select count(*)::integer into v_completed_attempts
  from public.game_attempts attempt
  where attempt.nick_key = v_challenge.nick_key
    and attempt.league_id is not distinct from v_challenge.league_id
    and (not v_is_global or attempt.quota_day = v_challenge.quota_day);

  select count(*)::integer into v_active_challenges
  from public.game_challenges challenge
  where challenge.nick_key = v_challenge.nick_key
    and challenge.league_id is not distinct from v_challenge.league_id
    and (not v_is_global or challenge.quota_day = v_challenge.quota_day)
    and challenge.consumed_at is null
    and challenge.expires_at > clock_timestamp();

  if v_is_global then
    v_bonus_attempts := public.game_player_daily_bonus(v_challenge.nick_key);
  end if;
  v_max_attempts := 5 + v_bonus_attempts;

  if v_completed_attempts + v_active_challenges > v_max_attempts then
    update public.game_challenges
    set consumed_at = clock_timestamp()
    where id = v_challenge.id;

    v_attempts_left := greatest(0, v_max_attempts - v_completed_attempts - (v_active_challenges - 1));
    return jsonb_build_object(
      'error', 'nick_limit',
      'attemptsLeft', v_attempts_left,
      'maxAttempts', v_max_attempts,
      'dailyResetAt', case when v_is_global then public.game_server_reset_at(v_challenge.quota_day) else null end
    );
  end if;

  return v_result || jsonb_build_object(
    'maxAttempts', v_max_attempts,
    'bonusAttempts', v_bonus_attempts,
    'dailyResetAt', case when v_is_global then public.game_server_reset_at(v_challenge.quota_day) else null end
  );
end;
$$;

create or replace function public.activate_game_challenge_pointer_only(
  p_challenge_id uuid,
  p_device_hash text,
  p_ip_hash text,
  p_countdown_ms integer
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_challenge public.game_challenges%rowtype;
  v_activated_at timestamptz := clock_timestamp();
  v_starts_at timestamptz;
  v_current_day date := public.game_server_day(v_activated_at);
  v_completed integer := 0;
  v_active integer := 0;
  v_max_attempts integer := 5;
begin
  if p_countdown_ms <> 3000 then return jsonb_build_object('error', 'invalid_countdown'); end if;

  select * into v_challenge
  from public.game_challenges
  where id = p_challenge_id
  for update;

  if not found then return jsonb_build_object('error', 'challenge_not_found'); end if;
  if v_challenge.consumed_at is not null then return jsonb_build_object('error', 'challenge_used'); end if;
  if v_challenge.prepared_at is null then return jsonb_build_object('error', 'challenge_not_prepared'); end if;
  if v_challenge.activated_at is not null then return jsonb_build_object('error', 'challenge_already_activated'); end if;
  if v_challenge.expires_at <= v_activated_at then return jsonb_build_object('error', 'challenge_expired'); end if;
  if v_challenge.device_hash <> p_device_hash or v_challenge.ip_hash <> p_ip_hash then
    return jsonb_build_object('error', 'device_mismatch');
  end if;

  if v_challenge.league_id is null and v_challenge.quota_day <> v_current_day then
    perform pg_advisory_xact_lock(hashtextextended(v_challenge.nick_key || ':global', 106));

    select count(*)::integer into v_completed
    from public.game_attempts attempt
    where attempt.nick_key = v_challenge.nick_key
      and attempt.league_id is null
      and attempt.quota_day = v_current_day;

    select count(*)::integer into v_active
    from public.game_challenges challenge
    where challenge.nick_key = v_challenge.nick_key
      and challenge.league_id is null
      and challenge.quota_day = v_current_day
      and challenge.id <> v_challenge.id
      and challenge.consumed_at is null
      and challenge.expires_at > v_activated_at;

    v_max_attempts := 5 + public.game_player_daily_bonus(v_challenge.nick_key);
    if v_completed + v_active >= v_max_attempts then
      update public.game_challenges set consumed_at = v_activated_at where id = v_challenge.id;
      return jsonb_build_object(
        'error', 'nick_limit',
        'attemptsLeft', 0,
        'maxAttempts', v_max_attempts,
        'dailyResetAt', public.game_server_reset_at(v_current_day)
      );
    end if;

    update public.game_challenges
    set quota_day = v_current_day
    where id = v_challenge.id;
  end if;

  v_starts_at := v_activated_at + p_countdown_ms * interval '1 millisecond';
  update public.game_challenges
  set activated_at = v_activated_at,
      started_at = v_starts_at,
      expires_at = v_starts_at + interval '30 seconds'
  where id = p_challenge_id;

  return jsonb_build_object(
    'ok', true,
    'activatedAt', v_activated_at,
    'startsAt', v_starts_at,
    'expiresAt', v_starts_at + interval '30 seconds'
  );
end;
$$;
