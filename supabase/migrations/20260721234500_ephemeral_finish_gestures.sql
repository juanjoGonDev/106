alter table public.game_challenges
  add column if not exists interaction_mode text not null default 'press',
  add column if not exists interaction_nonce uuid not null default gen_random_uuid(),
  add column if not exists target_x_percent smallint not null default 50,
  add column if not exists target_y_percent smallint not null default 50,
  add column if not exists min_hold_ms integer not null default 0,
  add column if not exists max_hold_ms integer not null default 0,
  add column if not exists keyboard_code text not null default 'Space',
  add column if not exists render_variant smallint not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'game_challenges_interaction_mode_check') then
    alter table public.game_challenges add constraint game_challenges_interaction_mode_check check (interaction_mode in ('press', 'release'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'game_challenges_target_x_check') then
    alter table public.game_challenges add constraint game_challenges_target_x_check check (target_x_percent between 20 and 80);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'game_challenges_target_y_check') then
    alter table public.game_challenges add constraint game_challenges_target_y_check check (target_y_percent between 20 and 80);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'game_challenges_hold_check') then
    alter table public.game_challenges add constraint game_challenges_hold_check check (min_hold_ms between 0 and 2000 and max_hold_ms between min_hold_ms and 3000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'game_challenges_keyboard_code_check') then
    alter table public.game_challenges add constraint game_challenges_keyboard_code_check check (keyboard_code in ('Enter', 'Space'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'game_challenges_render_variant_check') then
    alter table public.game_challenges add constraint game_challenges_render_variant_check check (render_variant between 0 and 7);
  end if;
end;
$$;

create or replace function public.start_game_challenge(
  p_nick text,
  p_nick_key text,
  p_team text,
  p_device_hash text,
  p_ip_hash text,
  p_referral_code uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempts_used integer;
  v_bonus_attempts integer;
  v_max_attempts integer;
  v_challenge_id uuid;
  v_referrer public.game_players%rowtype;
  v_mode text;
  v_nonce uuid := gen_random_uuid();
  v_target_x smallint;
  v_target_y smallint;
  v_min_hold integer;
  v_max_hold integer;
  v_keyboard text;
  v_variant smallint;
begin
  if p_team not in ('spain', 'argentina')
     or char_length(p_nick) not between 2 and 24
     or char_length(p_nick_key) not between 2 and 24 then
    return jsonb_build_object('error', 'invalid_input');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_nick_key, 106));

  insert into public.game_players(nick_key, nick, first_device_hash, first_ip_hash)
  values (p_nick_key, p_nick, p_device_hash, p_ip_hash)
  on conflict (nick_key) do update set nick = excluded.nick;

  insert into public.game_player_bonus(nick_key) values (p_nick_key)
  on conflict (nick_key) do nothing;

  if p_referral_code is not null then
    select * into v_referrer from public.game_players where referral_code = p_referral_code;
    if found
       and v_referrer.nick_key <> p_nick_key
       and v_referrer.first_device_hash <> p_device_hash
       and v_referrer.first_ip_hash <> p_ip_hash then
      insert into public.game_referrals(
        referral_code, referrer_nick_key, referred_nick_key,
        referred_device_hash, referred_ip_hash
      ) values (
        p_referral_code, v_referrer.nick_key, p_nick_key,
        p_device_hash, p_ip_hash
      ) on conflict (referred_nick_key) do nothing;
    end if;
  end if;

  select count(*)::integer into v_attempts_used
  from public.game_attempts where nick_key = p_nick_key;

  select coalesce(bonus_attempts, 0) into v_bonus_attempts
  from public.game_player_bonus where nick_key = p_nick_key;
  v_max_attempts := 5 + coalesce(v_bonus_attempts, 0);

  if v_attempts_used >= v_max_attempts then
    return jsonb_build_object('error', 'nick_limit', 'attemptsLeft', 0);
  end if;

  if (select count(*) from public.game_challenges
      where device_hash = p_device_hash
        and started_at > clock_timestamp() - interval '1 minute') >= 8 then
    return jsonb_build_object('error', 'rate_limit');
  end if;

  if (select count(*) from public.game_challenges
      where ip_hash = p_ip_hash
        and started_at > clock_timestamp() - interval '1 minute') >= 40 then
    return jsonb_build_object('error', 'rate_limit');
  end if;

  if (select count(*) from public.game_attempts
      where device_hash = p_device_hash
        and created_at > clock_timestamp() - interval '24 hours') >= 150 then
    return jsonb_build_object('error', 'daily_limit');
  end if;

  v_mode := case when random() < 0.5 then 'press' else 'release' end;
  v_target_x := (34 + floor(random() * 33))::smallint;
  v_target_y := (40 + floor(random() * 21))::smallint;
  v_min_hold := case when v_mode = 'release' then 140 + floor(random() * 121)::integer else 0 end;
  v_max_hold := case when v_mode = 'release' then v_min_hold + 620 else 0 end;
  v_keyboard := case when random() < 0.5 then 'Enter' else 'Space' end;
  v_variant := floor(random() * 8)::smallint;

  insert into public.game_challenges (
    nick, nick_key, team, device_hash, ip_hash,
    interaction_mode, interaction_nonce, target_x_percent, target_y_percent,
    min_hold_ms, max_hold_ms, keyboard_code, render_variant
  ) values (
    p_nick, p_nick_key, p_team, p_device_hash, p_ip_hash,
    v_mode, v_nonce, v_target_x, v_target_y,
    v_min_hold, v_max_hold, v_keyboard, v_variant
  ) returning id into v_challenge_id;

  return jsonb_build_object(
    'challengeId', v_challenge_id,
    'attemptsLeft', v_max_attempts - v_attempts_used,
    'maxAttempts', v_max_attempts,
    'interaction', jsonb_build_object(
      'mode', v_mode,
      'nonce', v_nonce,
      'xPercent', v_target_x,
      'yPercent', v_target_y,
      'minHoldMs', v_min_hold,
      'maxHoldMs', v_max_hold,
      'keyboardKey', v_keyboard,
      'variant', v_variant
    )
  );
end;
$$;

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
  v_bonus_attempts integer;
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
begin
  select * into v_challenge from public.game_challenges
  where id = p_challenge_id for update;

  if not found then return jsonb_build_object('error', 'challenge_not_found'); end if;
  if v_challenge.consumed_at is not null then return jsonb_build_object('error', 'challenge_used'); end if;

  update public.game_challenges set consumed_at = v_now where id = p_challenge_id;

  if v_challenge.expires_at < v_now then return jsonb_build_object('error', 'challenge_expired'); end if;
  if v_challenge.device_hash <> p_device_hash then return jsonb_build_object('error', 'device_mismatch'); end if;
  if p_client_elapsed_ms is null or p_client_elapsed_ms not between 500 and 30000 then
    return jsonb_build_object('error', 'invalid_timing');
  end if;

  v_server_elapsed_ms := round(extract(epoch from (v_now - v_challenge.started_at)) * 1000)::integer;
  if v_server_elapsed_ms not between 8000 and 18000 then return jsonb_build_object('error', 'invalid_timing'); end if;
  if abs(v_server_elapsed_ms - p_client_elapsed_ms) > 5000 then return jsonb_build_object('error', 'timing_mismatch'); end if;

  if coalesce(p_client_signals->>'pointerXPercent', '') ~ '^-?[0-9]+([.][0-9]+)?$' then
    v_signal_x := (p_client_signals->>'pointerXPercent')::numeric;
  end if;
  if coalesce(p_client_signals->>'pointerYPercent', '') ~ '^-?[0-9]+([.][0-9]+)?$' then
    v_signal_y := (p_client_signals->>'pointerYPercent')::numeric;
  end if;
  if coalesce(p_client_signals->>'holdDurationMs', '') ~ '^[0-9]{1,5}$' then
    v_hold_ms := (p_client_signals->>'holdDurationMs')::integer;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_challenge.nick_key, 106));
  select count(*)::integer into v_attempts_used from public.game_attempts where nick_key = v_challenge.nick_key;
  select coalesce(bonus_attempts, 0) into v_bonus_attempts from public.game_player_bonus where nick_key = v_challenge.nick_key;
  v_max_attempts := 5 + coalesce(v_bonus_attempts, 0);
  if v_attempts_used >= v_max_attempts then return jsonb_build_object('error', 'nick_limit', 'attemptsLeft', 0); end if;

  v_difference_ms := abs(10600 - p_client_elapsed_ms);
  if abs(v_server_elapsed_ms - p_client_elapsed_ms) > 3000 then
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

  if v_finish_event = 'keydown' then
    if coalesce(p_client_signals->>'pointerTrusted', 'false') <> 'true'
       or v_keyboard_key <> case when v_challenge.keyboard_code = 'Space' then ' ' else 'Enter' end then
      v_verified := false;
      v_reasons := array_append(v_reasons, 'invalid_keyboard_finish');
    end if;
  else
    if v_finish_event <> case when v_challenge.interaction_mode = 'release' then 'pointerup' else 'pointerdown' end
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

  if coalesce(p_client_signals->>'automationDetected', 'false') = 'true' then
    v_verified := false;
    v_reasons := array_append(v_reasons, 'browser_automation_detected');
  end if;

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
    challenge_id, nick, nick_key, team, device_hash, ip_hash,
    client_elapsed_ms, server_elapsed_ms, difference_ms,
    verified, verification_reasons, client_signals
  ) values (
    v_challenge.id, v_challenge.nick, v_challenge.nick_key, v_challenge.team,
    v_challenge.device_hash, p_ip_hash, p_client_elapsed_ms, v_server_elapsed_ms,
    v_difference_ms, v_verified, v_reasons, coalesce(p_client_signals, '{}'::jsonb)
  ) returning id into v_attempt_id;

  if v_verified then
    select * into v_referral from public.game_referrals
    where referred_nick_key = v_challenge.nick_key and completed_at is null
    for update;

    if found and (select count(*) from public.game_attempts
                  where nick_key = v_challenge.nick_key and verified = true) >= 5 then
      update public.game_referrals set completed_at = v_now where id = v_referral.id;
      insert into public.game_player_bonus(nick_key, bonus_attempts, updated_at)
      values (v_referral.referrer_nick_key, 1, v_now)
      on conflict (nick_key) do update
      set bonus_attempts = public.game_player_bonus.bonus_attempts + 1,
          updated_at = excluded.updated_at;
    end if;
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
      'createdAt', v_now
    ),
    'attemptsLeft', v_attempts_left,
    'maxAttempts', v_max_attempts
  );
end;
$$;