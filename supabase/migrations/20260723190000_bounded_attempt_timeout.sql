create or replace function public.finish_game_attempt(
  p_challenge_id uuid,
  p_client_elapsed_ms integer,
  p_device_hash text,
  p_ip_hash text,
  p_client_signals jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_challenge public.game_challenges%rowtype;
  v_now timestamptz := clock_timestamp();
  v_server_elapsed_ms integer;
  v_difference_ms integer;
  v_attempts_used integer;
  v_bonus_attempts integer := 0;
  v_max_attempts integer;
  v_attempts_left integer;
  v_attempt_id uuid;
  v_verified boolean := true;
  v_reasons text[] := '{}';
  v_prior_near_perfect integer;
  v_referral public.game_referrals%rowtype;
  v_signal_mode text := left(coalesce(p_client_signals->>'interactionMode', ''), 16);
  v_signal_nonce text := left(coalesce(p_client_signals->>'controlNonce', ''), 64);
  v_finish_event text := left(coalesce(p_client_signals->>'finishEvent', ''), 24);
  v_pointer_type text := left(coalesce(p_client_signals->>'pointerType', ''), 16);
  v_keyboard_key text := left(coalesce(p_client_signals->>'keyboardKey', ''), 16);
  v_signal_x numeric := -1;
  v_signal_y numeric := -1;
  v_hold_ms integer := -1;
  v_repeated_fingerprint integer := 0;
  v_league_code text;
  v_league_name text;
  v_is_timeout boolean := p_client_elapsed_ms = 30000
    and v_finish_event = ''
    and v_pointer_type = 'unknown'
    and coalesce(p_client_signals->>'pointerTrusted', 'false') = 'true'
    and coalesce(p_client_signals->>'timerConcealed', 'false') = 'true'
    and coalesce(p_client_signals->>'pointerMoveCount', '0') = '0'
    and coalesce(p_client_signals->>'pointerTravelPx', '0') = '0';
begin
  select * into v_challenge from public.game_challenges
  where id = p_challenge_id for update;

  if not found then return jsonb_build_object('error', 'challenge_not_found'); end if;
  if v_challenge.consumed_at is not null then return jsonb_build_object('error', 'challenge_used'); end if;

  update public.game_challenges set consumed_at = v_now where id = p_challenge_id;

  if v_is_timeout then
    if v_challenge.expires_at + interval '10 seconds' < v_now then
      return jsonb_build_object('error', 'challenge_expired');
    end if;
  elsif v_challenge.expires_at < v_now then
    return jsonb_build_object('error', 'challenge_expired');
  end if;

  if v_challenge.device_hash <> p_device_hash then return jsonb_build_object('error', 'device_mismatch'); end if;
  if p_client_elapsed_ms is null or p_client_elapsed_ms not between 2000 and 30000 then
    return jsonb_build_object('error', 'invalid_timing');
  end if;

  v_server_elapsed_ms := round(extract(epoch from (v_now - v_challenge.started_at)) * 1000)::integer;
  if v_is_timeout then
    if v_server_elapsed_ms not between 29500 and 40000 then return jsonb_build_object('error', 'invalid_timing'); end if;
  else
    if v_server_elapsed_ms not between 1800 and 35000 then return jsonb_build_object('error', 'invalid_timing'); end if;
    if abs(v_server_elapsed_ms - p_client_elapsed_ms) > 5000 then return jsonb_build_object('error', 'timing_mismatch'); end if;
  end if;

  if coalesce(p_client_signals->>'pointerXPercent', '') ~ '^-?[0-9]+([.][0-9]+)?$' then
    v_signal_x := (p_client_signals->>'pointerXPercent')::numeric;
  end if;
  if coalesce(p_client_signals->>'pointerYPercent', '') ~ '^-?[0-9]+([.][0-9]+)?$' then
    v_signal_y := (p_client_signals->>'pointerYPercent')::numeric;
  end if;
  if coalesce(p_client_signals->>'holdDurationMs', '') ~ '^[0-9]{1,5}$' then
    v_hold_ms := (p_client_signals->>'holdDurationMs')::integer;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    v_challenge.nick_key || ':' || coalesce(v_challenge.league_id::text, 'global'),
    106
  ));

  select count(*)::integer into v_attempts_used
  from public.game_attempts
  where nick_key = v_challenge.nick_key
    and league_id is not distinct from v_challenge.league_id;

  if v_challenge.league_id is null then
    select coalesce(bonus_attempts, 0) into v_bonus_attempts
    from public.game_player_bonus where nick_key = v_challenge.nick_key;
  end if;
  v_max_attempts := 5 + coalesce(v_bonus_attempts, 0);
  if v_attempts_used >= v_max_attempts then return jsonb_build_object('error', 'nick_limit', 'attemptsLeft', 0); end if;

  v_difference_ms := abs(10600 - p_client_elapsed_ms);
  if not v_is_timeout and abs(v_server_elapsed_ms - p_client_elapsed_ms) > 3000 then
    v_verified := false;
    v_reasons := array_append(v_reasons, 'large_network_delta');
  end if;
  if v_challenge.ip_hash <> p_ip_hash then
    v_verified := false;
    v_reasons := array_append(v_reasons, 'ip_changed_during_attempt');
  end if;
  if coalesce(p_client_signals->>'trustedStart', 'false') <> 'true'
     or coalesce(p_client_signals->>'trustedFinish', 'false') <> 'true'
     or coalesce(p_client_signals->>'timerConcealed', 'false') <> 'true' then
    v_verified := false;
    v_reasons := array_append(v_reasons, 'invalid_client_interaction');
  end if;
  if coalesce(p_client_signals->>'visibilityChanges', '0') <> '0'
     or coalesce(p_client_signals->>'focusLosses', '0') <> '0' then
    v_verified := false;
    v_reasons := array_append(v_reasons, 'focus_changed_during_attempt');
  end if;

  if v_signal_mode <> v_challenge.interaction_mode
     or v_signal_nonce <> v_challenge.interaction_nonce::text then
    v_verified := false;
    v_reasons := array_append(v_reasons, 'interaction_challenge_mismatch');
  end if;

  if not v_is_timeout then
    if v_finish_event = 'keydown' then
      if coalesce(p_client_signals->>'pointerTrusted', 'false') <> 'true'
         or v_keyboard_key <> (case when v_challenge.keyboard_code = 'Space' then ' ' else 'Enter' end) then
        v_verified := false;
        v_reasons := array_append(v_reasons, 'invalid_keyboard_finish');
      end if;
    else
      if v_finish_event <> (case when v_challenge.interaction_mode = 'release' then 'pointerup' else 'pointerdown' end)
         or coalesce(p_client_signals->>'pointerTrusted', 'false') <> 'true'
         or coalesce(p_client_signals->>'userActivation', 'false') <> 'true' then
        v_verified := false;
        v_reasons := array_append(v_reasons, 'invalid_pointer_finish');
      end if;
      if abs(v_signal_x - v_challenge.target_x_percent) > 18
         or abs(v_signal_y - v_challenge.target_y_percent) > 18 then
        v_verified := false;
        v_reasons := array_append(v_reasons, 'pointer_outside_target');
      end if;
      if v_challenge.interaction_mode = 'release'
         and (v_hold_ms not between v_challenge.min_hold_ms and v_challenge.max_hold_ms
              or coalesce(p_client_signals->>'samePointer', 'false') <> 'true') then
        v_verified := false;
        v_reasons := array_append(v_reasons, 'invalid_hold_gesture');
      end if;
    end if;
  end if;

  if coalesce(p_client_signals->>'automationDetected', 'false') = 'true' then
    v_verified := false;
    v_reasons := array_append(v_reasons, 'browser_automation_detected');
  end if;

  if not v_is_timeout then
    select count(*)::integer into v_repeated_fingerprint
    from public.game_attempts
    where device_hash = p_device_hash
      and created_at > v_now - interval '24 hours'
      and client_signals->>'finishEvent' = v_finish_event
      and client_signals->>'pointerType' = v_pointer_type
      and client_signals->>'pointerXPercent' = p_client_signals->>'pointerXPercent'
      and client_signals->>'pointerYPercent' = p_client_signals->>'pointerYPercent'
      and client_signals->>'holdDurationMs' = p_client_signals->>'holdDurationMs'
      and client_signals->>'pointerMoveCount' = p_client_signals->>'pointerMoveCount';
    if v_repeated_fingerprint >= 2 then
      v_verified := false;
      v_reasons := array_append(v_reasons, 'repeated_interaction_fingerprint');
    end if;
  end if;

  select count(*)::integer into v_prior_near_perfect
  from public.game_attempts
  where (device_hash = p_device_hash or ip_hash = p_ip_hash)
    and difference_ms <= 5
    and created_at > v_now - interval '24 hours';
  if v_difference_ms <= 5 and v_prior_near_perfect >= 2 then
    v_verified := false;
    v_reasons := array_append(v_reasons, 'repeated_near_perfect_results');
  end if;

  insert into public.game_attempts (
    challenge_id, nick, nick_key, team, device_hash, ip_hash, league_id,
    client_elapsed_ms, server_elapsed_ms, difference_ms,
    verified, verification_reasons, client_signals
  ) values (
    v_challenge.id, v_challenge.nick, v_challenge.nick_key, v_challenge.team,
    v_challenge.device_hash, p_ip_hash, v_challenge.league_id,
    p_client_elapsed_ms, v_server_elapsed_ms,
    v_difference_ms, v_verified, v_reasons, coalesce(p_client_signals, '{}'::jsonb)
  ) returning id into v_attempt_id;

  if v_verified and v_challenge.league_id is null then
    select * into v_referral from public.game_referrals
    where referred_nick_key = v_challenge.nick_key and completed_at is null
    for update;

    if found and (select count(*) from public.game_attempts
                  where nick_key = v_challenge.nick_key
                    and verified = true
                    and league_id is null) >= 5 then
      update public.game_referrals set completed_at = v_now where id = v_referral.id;
      insert into public.game_player_bonus(nick_key, bonus_attempts, updated_at)
      values (v_referral.referrer_nick_key, 1, v_now)
      on conflict (nick_key) do update
      set bonus_attempts = public.game_player_bonus.bonus_attempts + 1,
          updated_at = excluded.updated_at;
    end if;
  end if;

  if v_challenge.league_id is not null then
    select code, name into v_league_code, v_league_name
    from public.game_leagues where id = v_challenge.league_id;
  end if;

  v_attempts_left := v_max_attempts - v_attempts_used - 1;
  return jsonb_build_object(
    'attempt', jsonb_build_object(
      'id', v_attempt_id,
      'nick', v_challenge.nick,
      'team', v_challenge.team,
      'elapsedMs', p_client_elapsed_ms,
      'differenceMs', v_difference_ms,
      'verified', v_verified,
      'createdAt', v_now,
      'competitionType', case when v_challenge.league_id is null then 'global' else 'league' end,
      'leagueCode', v_league_code,
      'leagueName', v_league_name
    ),
    'competition', jsonb_build_object(
      'type', case when v_challenge.league_id is null then 'global' else 'league' end,
      'code', v_league_code,
      'name', v_league_name
    ),
    'attemptsLeft', v_attempts_left,
    'maxAttempts', v_max_attempts
  );
end;
$$;

create or replace function public.finish_game_attempt_pointer_only(
  p_challenge_id uuid,
  p_client_elapsed_ms integer,
  p_device_hash text,
  p_ip_hash text,
  p_client_signals jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_challenge public.game_challenges%rowtype;
  v_pointer_type text := left(coalesce(p_client_signals->>'pointerType', ''), 16);
  v_normalized_signals jsonb := coalesce(p_client_signals, '{}'::jsonb);
  v_is_timeout boolean := p_client_elapsed_ms = 30000
    and coalesce(p_client_signals->>'finishEvent', '') = ''
    and v_pointer_type = 'unknown'
    and coalesce(p_client_signals->>'pointerTrusted', 'false') = 'true'
    and coalesce(p_client_signals->>'timerConcealed', 'false') = 'true'
    and coalesce(p_client_signals->>'pointerMoveCount', '0') = '0'
    and coalesce(p_client_signals->>'pointerTravelPx', '0') = '0';
begin
  select * into v_challenge
  from public.game_challenges
  where id = p_challenge_id
  for update;

  if not found then return jsonb_build_object('error', 'challenge_not_found'); end if;
  if v_challenge.prepared_at is not null and v_challenge.activated_at is null then
    return jsonb_build_object('error', 'challenge_not_activated');
  end if;

  if v_is_timeout then
    if v_challenge.interaction_mode <> 'press'
       or coalesce(p_client_signals->>'interactionMode', '') <> 'press'
       or coalesce(p_client_signals->>'controlNonce', '') <> v_challenge.interaction_nonce::text
       or coalesce(p_client_signals->>'trustedStart', 'false') <> 'true'
       or coalesce(p_client_signals->>'trustedFinish', 'false') <> 'true' then
      return jsonb_build_object('error', 'invalid_pointer_finish');
    end if;
  elsif v_challenge.interaction_mode <> 'press'
     or coalesce(p_client_signals->>'interactionMode', '') <> 'press'
     or coalesce(p_client_signals->>'finishEvent', '') <> 'pointerdown'
     or v_pointer_type not in ('mouse', 'touch', 'pen')
     or coalesce(p_client_signals->>'pointerTrusted', 'false') <> 'true'
     or coalesce(p_client_signals->>'keyboardKey', '') <> '' then
    return jsonb_build_object('error', 'invalid_pointer_finish');
  end if;

  if not v_is_timeout and v_pointer_type = 'mouse'
     and coalesce(p_client_signals->>'userActivation', 'false') <> 'true' then
    return jsonb_build_object('error', 'invalid_pointer_finish');
  end if;

  if not v_is_timeout and v_pointer_type in ('touch', 'pen')
     and coalesce(p_client_signals->>'automationDetected', 'false') = 'true' then
    return jsonb_build_object('error', 'invalid_pointer_finish');
  end if;

  v_normalized_signals := jsonb_set(
    v_normalized_signals,
    '{userActivationObserved}',
    case
      when coalesce(p_client_signals->>'userActivation', 'false') = 'true' then 'true'::jsonb
      else 'false'::jsonb
    end,
    true
  );

  if not v_is_timeout and v_pointer_type in ('touch', 'pen') then
    v_normalized_signals := jsonb_set(
      v_normalized_signals,
      '{userActivation}',
      'true'::jsonb,
      true
    );
  end if;

  return public.finish_game_attempt(
    p_challenge_id,
    p_client_elapsed_ms,
    p_device_hash,
    p_ip_hash,
    v_normalized_signals
  );
end;
$$;

revoke all on function public.finish_game_attempt(uuid, integer, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.finish_game_attempt_pointer_only(uuid, integer, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.finish_game_attempt(uuid, integer, text, text, jsonb) to service_role;
grant execute on function public.finish_game_attempt_pointer_only(uuid, integer, text, text, jsonb) to service_role;
