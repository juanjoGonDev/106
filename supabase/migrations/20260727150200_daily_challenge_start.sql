create or replace function public.start_game_challenge(
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
  v_attempts_used integer;
  v_bonus_attempts integer := 0;
  v_max_attempts integer;
  v_challenge_id uuid;
  v_league public.game_leagues%rowtype;
  v_league_id uuid;
  v_is_global boolean := nullif(trim(coalesce(p_league_code, '')), '') is null;
  v_quota_day date := public.game_server_day(clock_timestamp());
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

  if not v_is_global then
    select * into v_league
    from public.game_leagues
    where code = upper(trim(p_league_code));

    if not found then return jsonb_build_object('error', 'league_not_found'); end if;
    if v_league.ends_at <= clock_timestamp() then return jsonb_build_object('error', 'league_finished'); end if;
    if not exists (
      select 1 from public.game_league_members
      where league_id = v_league.id and nick_key = p_nick_key
    ) then
      return jsonb_build_object('error', 'league_membership_required');
    end if;
    v_league_id := v_league.id;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_nick_key || ':' || coalesce(v_league_id::text, 'global'),
    106
  ));

  insert into public.game_players(nick_key, nick, first_device_hash, first_ip_hash)
  values (p_nick_key, p_nick, p_device_hash, p_ip_hash)
  on conflict (nick_key) do update set nick = excluded.nick;

  insert into public.game_player_bonus(nick_key) values (p_nick_key)
  on conflict (nick_key) do nothing;

  if v_is_global and p_referral_code is not null then
    perform public.register_game_account_referral(
      p_referral_code,
      p_nick_key,
      p_device_hash,
      p_ip_hash
    );
  end if;

  select count(*)::integer into v_attempts_used
  from public.game_attempts attempt
  where attempt.nick_key = p_nick_key
    and attempt.league_id is not distinct from v_league_id
    and (not v_is_global or attempt.quota_day = v_quota_day);

  if v_is_global then
    v_bonus_attempts := public.game_player_daily_bonus(p_nick_key);
  end if;
  v_max_attempts := 5 + coalesce(v_bonus_attempts, 0);

  if v_attempts_used >= v_max_attempts then
    return jsonb_build_object(
      'error', 'nick_limit',
      'attemptsLeft', 0,
      'maxAttempts', v_max_attempts,
      'dailyResetAt', case when v_is_global then public.game_server_reset_at(v_quota_day) else null end
    );
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
    nick, nick_key, team, device_hash, ip_hash, league_id, quota_day,
    interaction_mode, interaction_nonce, target_x_percent, target_y_percent,
    min_hold_ms, max_hold_ms, keyboard_code, render_variant
  ) values (
    p_nick, p_nick_key, p_team, p_device_hash, p_ip_hash, v_league_id,
    case when v_is_global then v_quota_day else null end,
    v_mode, v_nonce, v_target_x, v_target_y,
    v_min_hold, v_max_hold, v_keyboard, v_variant
  ) returning id into v_challenge_id;

  return jsonb_build_object(
    'challengeId', v_challenge_id,
    'attemptsLeft', v_max_attempts - v_attempts_used,
    'maxAttempts', v_max_attempts,
    'bonusAttempts', v_bonus_attempts,
    'dailyResetAt', case when v_is_global then public.game_server_reset_at(v_quota_day) else null end,
    'competition', jsonb_build_object(
      'type', case when v_is_global then 'global' else 'league' end,
      'code', case when v_is_global then null else v_league.code end,
      'name', case when v_is_global then null else v_league.name end
    ),
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
