alter table public.game_challenges
  add column if not exists league_id uuid references public.game_leagues(id) on delete restrict;

alter table public.game_attempts
  add column if not exists league_id uuid references public.game_leagues(id) on delete restrict;

create index if not exists game_challenges_league_started_idx
  on public.game_challenges(league_id, started_at desc);
create index if not exists game_attempts_league_rank_idx
  on public.game_attempts(league_id, verified, difference_ms, created_at);
create index if not exists game_attempts_global_rank_idx
  on public.game_attempts(verified, difference_ms, created_at)
  where league_id is null;

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
  v_referrer public.game_players%rowtype;
  v_league public.game_leagues%rowtype;
  v_league_id uuid;
  v_is_global boolean := nullif(trim(coalesce(p_league_code, '')), '') is null;
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
  from public.game_attempts
  where nick_key = p_nick_key
    and league_id is not distinct from v_league_id;

  if v_is_global then
    select coalesce(bonus_attempts, 0) into v_bonus_attempts
    from public.game_player_bonus where nick_key = p_nick_key;
  end if;
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
    nick, nick_key, team, device_hash, ip_hash, league_id,
    interaction_mode, interaction_nonce, target_x_percent, target_y_percent,
    min_hold_ms, max_hold_ms, keyboard_code, render_variant
  ) values (
    p_nick, p_nick_key, p_team, p_device_hash, p_ip_hash, v_league_id,
    v_mode, v_nonce, v_target_x, v_target_y,
    v_min_hold, v_max_hold, v_keyboard, v_variant
  ) returning id into v_challenge_id;

  return jsonb_build_object(
    'challengeId', v_challenge_id,
    'attemptsLeft', v_max_attempts - v_attempts_used,
    'maxAttempts', v_max_attempts,
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

create or replace function public.get_game_nick_status(p_nick_key text)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'attemptsUsed', count(*)::integer,
    'attemptsLeft', greatest(0, 5 + coalesce((select bonus_attempts from public.game_player_bonus where nick_key = p_nick_key), 0) - count(*)::integer)
  )
  from public.game_attempts
  where nick_key = p_nick_key and league_id is null;
$$;

create or replace function public.get_game_player_profile(p_nick_key text)
returns jsonb
language sql stable security definer set search_path = public, pg_temp
as $$
with player_attempts as (
  select * from public.game_attempts where nick_key = p_nick_key and league_id is null
), verified_attempts as (
  select * from player_attempts where verified = true
), player_summary as (
  select count(*)::integer as verified_count,
    round(avg(difference_ms))::integer as average_difference_ms,
    min(difference_ms)::integer as best_difference_ms
  from verified_attempts
), all_summaries as (
  select nick_key,
    round(avg(difference_ms))::integer as average_difference_ms,
    min(difference_ms)::integer as best_difference_ms
  from public.game_attempts
  where verified = true and league_id is null
  group by nick_key
), ranked as (
  select nick_key,
    dense_rank() over(order by average_difference_ms asc, best_difference_ms asc)::integer as average_rank,
    dense_rank() over(order by best_difference_ms asc, average_difference_ms asc)::integer as best_rank
  from all_summaries
), base as (
  select p.nick, p.referral_code,
    coalesce(b.bonus_attempts, 0)::integer as bonus_attempts,
    (select count(*)::integer from player_attempts) as attempts_used,
    (select count(*)::integer from public.game_referrals where referrer_nick_key = p.nick_key and completed_at is not null) as completed_referrals,
    (select count(*)::integer from all_summaries) as total_players,
    s.verified_count, s.average_difference_ms, s.best_difference_ms,
    r.average_rank, r.best_rank
  from public.game_players p
  left join public.game_player_bonus b on b.nick_key = p.nick_key
  cross join player_summary s
  left join ranked r on r.nick_key = p.nick_key
  where p.nick_key = p_nick_key
)
select coalesce((select jsonb_build_object(
  'nick', nick,
  'referralCode', referral_code,
  'bonusAttempts', bonus_attempts,
  'maxAttempts', 5 + bonus_attempts,
  'attemptsUsed', attempts_used,
  'attemptsLeft', greatest(0, 5 + bonus_attempts - attempts_used),
  'verifiedAttempts', verified_count,
  'averageDifferenceMs', average_difference_ms,
  'bestDifferenceMs', best_difference_ms,
  'globalRankAverage', average_rank,
  'globalRankBest', best_rank,
  'totalPlayers', total_players,
  'completedReferrals', completed_referrals,
  'history', coalesce((select jsonb_agg(jsonb_build_object(
    'id', a.id, 'team', a.team, 'elapsedMs', a.client_elapsed_ms,
    'differenceMs', a.difference_ms, 'verified', a.verified, 'createdAt', a.created_at,
    'competitionType', 'global'
  ) order by a.created_at desc) from (select * from player_attempts order by created_at desc limit 20) a), '[]'::jsonb)
) from base), jsonb_build_object(
  'attemptsUsed', 0, 'attemptsLeft', 5, 'maxAttempts', 5,
  'verifiedAttempts', 0, 'bonusAttempts', 0, 'completedReferrals', 0,
  'totalPlayers', (select count(*)::integer from all_summaries), 'history', '[]'::jsonb
));
$$;

create or replace function public.get_game_stats()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
with best as (
  select distinct on (team, nick_key)
    id, nick, nick_key, team, client_elapsed_ms, difference_ms, created_at
  from public.game_attempts
  where verified = true and league_id is null
  order by team, nick_key, difference_ms asc, created_at asc
), team_list(team) as (values ('spain'::text), ('argentina'::text)),
team_stats as (
  select teams.team,
    (select count(*)::integer from public.game_attempts a where a.team = teams.team and a.league_id is null) as attempts,
    count(best.id)::integer as players,
    case when count(best.id) > 0 then round(avg(best.difference_ms))::integer else null end as average_difference_ms,
    coalesce(sum(greatest(1, 100 - floor(best.difference_ms / 10.0)::integer)), 0)::bigint as score
  from team_list teams left join best on best.team = teams.team group by teams.team
), leaderboard as (
  select * from best order by difference_ms asc, created_at asc limit 10
)
select jsonb_build_object(
  'targetMs', 10600,
  'maxAttemptsPerNick', 5,
  'scoreVersion', 2,
  'scoreMaxPerPlayer', 100,
  'totalAttempts', (select count(*)::integer from public.game_attempts where league_id is null),
  'verifiedAttempts', (select count(*)::integer from public.game_attempts where verified = true and league_id is null),
  'totalPlayers', (select count(distinct nick_key)::integer from public.game_attempts where verified = true and league_id is null),
  'perfectAttempts', (select count(*)::integer from public.game_attempts where verified = true and difference_ms = 0 and league_id is null),
  'teams', coalesce((select jsonb_agg(jsonb_build_object(
    'team', team, 'attempts', attempts, 'players', players,
    'averageDifferenceMs', average_difference_ms, 'score', score
  ) order by case team when 'spain' then 1 else 2 end) from team_stats), '[]'::jsonb),
  'leaderboard', coalesce((select jsonb_agg(jsonb_build_object(
    'id', id, 'nick', nick, 'team', team, 'elapsedMs', client_elapsed_ms,
    'differenceMs', difference_ms, 'createdAt', created_at
  ) order by difference_ms asc, created_at asc) from leaderboard), '[]'::jsonb)
);
$$;

create or replace function public.create_game_duel(
  p_nick_key text,
  p_device_hash text,
  p_ip_hash text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_best integer;
  v_code uuid;
begin
  select min(difference_ms) into v_best
  from public.game_attempts
  where nick_key = p_nick_key and verified = true and league_id is null;
  if v_best is null then return jsonb_build_object('error','no_verified_attempt'); end if;
  if (select count(*) from public.game_duels where challenger_nick_key = p_nick_key and created_at > clock_timestamp() - interval '1 day') >= 10 then
    return jsonb_build_object('error','duel_daily_limit');
  end if;
  insert into public.game_duels(challenger_nick_key, challenger_best_difference_ms, challenger_device_hash, challenger_ip_hash)
  values (p_nick_key, v_best, p_device_hash, p_ip_hash) returning code into v_code;
  return jsonb_build_object('code',v_code,'targetDifferenceMs',v_best,'expiresAt',clock_timestamp() + interval '3 days');
end $$;

create or replace function public.resolve_game_duel(
  p_code uuid,
  p_opponent_nick_key text,
  p_device_hash text,
  p_ip_hash text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_duel public.game_duels%rowtype;
  v_best integer;
  v_won boolean;
begin
  select * into v_duel from public.game_duels where code = p_code for update;
  if not found then return jsonb_build_object('error','duel_not_found'); end if;
  if v_duel.status <> 'open' or v_duel.expires_at < clock_timestamp() then return jsonb_build_object('error','duel_closed'); end if;
  if v_duel.challenger_nick_key = p_opponent_nick_key or v_duel.challenger_device_hash = p_device_hash or v_duel.challenger_ip_hash = p_ip_hash then
    return jsonb_build_object('error','duel_self');
  end if;
  select min(difference_ms) into v_best
  from public.game_attempts
  where nick_key = p_opponent_nick_key
    and verified = true
    and league_id is null
    and created_at >= v_duel.created_at;
  if v_best is null then return jsonb_build_object('error','duel_incomplete'); end if;
  v_won := v_best < v_duel.challenger_best_difference_ms;
  update public.game_duels set opponent_nick_key = p_opponent_nick_key, opponent_device_hash = p_device_hash,
    opponent_ip_hash = p_ip_hash, opponent_best_difference_ms = v_best,
    status = case when v_won then 'won' else 'lost' end, completed_at = clock_timestamp(), reward_granted = true
  where id = v_duel.id;
  insert into public.game_player_bonus(nick_key, bonus_attempts, updated_at)
  values (case when v_won then p_opponent_nick_key else v_duel.challenger_nick_key end, case when v_won then 3 else 1 end, clock_timestamp())
  on conflict (nick_key) do update set bonus_attempts = public.game_player_bonus.bonus_attempts + excluded.bonus_attempts, updated_at = excluded.updated_at;
  return jsonb_build_object('won',v_won,'rewardAttempts',case when v_won then 3 else 1 end,'challengerBestDifferenceMs',v_duel.challenger_best_difference_ms,'opponentBestDifferenceMs',v_best);
end $$;

create or replace function public.get_game_league(p_code text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
with l as (
  select * from public.game_leagues where code = upper(trim(p_code))
), member_stats as (
  select m.nick_key, p.nick, m.joined_at,
    count(a.id)::integer as attempts_used,
    count(a.id) filter (where a.verified = true)::integer as verified_attempts,
    min(a.difference_ms) filter (where a.verified = true)::integer as best_difference_ms
  from l
  join public.game_league_members m on m.league_id = l.id
  join public.game_players p on p.nick_key = m.nick_key
  left join public.game_attempts a on a.league_id = l.id and a.nick_key = m.nick_key
  group by m.nick_key, p.nick, m.joined_at
), ranked as (
  select *, case when best_difference_ms is null then null else
    dense_rank() over(order by best_difference_ms asc nulls last, joined_at asc)::integer end as rank
  from member_stats
)
select coalesce((select jsonb_build_object(
  'code', l.code,
  'name', l.name,
  'startsAt', l.starts_at,
  'endsAt', l.ends_at,
  'active', l.ends_at > clock_timestamp(),
  'members', (select count(*)::integer from ranked),
  'totalAttempts', (select coalesce(sum(attempts_used), 0)::integer from ranked),
  'leaderboard', coalesce((select jsonb_agg(jsonb_build_object(
    'nick', nick,
    'rank', rank,
    'bestDifferenceMs', best_difference_ms,
    'attemptsUsed', attempts_used,
    'verifiedAttempts', verified_attempts
  ) order by rank nulls last, joined_at asc, nick asc) from ranked), '[]'::jsonb)
) from l), '{}'::jsonb);
$$;

create or replace function public.get_game_league_player_status(
  p_code text,
  p_nick_key text
) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_league public.game_leagues%rowtype;
  v_attempts integer;
  v_verified integer;
  v_best integer;
  v_rank integer;
  v_history jsonb;
begin
  select * into v_league from public.game_leagues where code = upper(trim(p_code));
  if not found then return jsonb_build_object('error', 'league_not_found'); end if;
  if not exists (
    select 1 from public.game_league_members where league_id = v_league.id and nick_key = p_nick_key
  ) then
    return jsonb_build_object('error', 'league_membership_required');
  end if;

  select count(*)::integer,
    count(*) filter (where verified = true)::integer,
    min(difference_ms) filter (where verified = true)::integer
  into v_attempts, v_verified, v_best
  from public.game_attempts
  where league_id = v_league.id and nick_key = p_nick_key;

  with member_best as (
    select m.nick_key, m.joined_at,
      min(a.difference_ms) filter (where a.verified = true)::integer as best_difference_ms
    from public.game_league_members m
    left join public.game_attempts a on a.league_id = m.league_id and a.nick_key = m.nick_key
    where m.league_id = v_league.id
    group by m.nick_key, m.joined_at
  ), ranked as (
    select nick_key, case when best_difference_ms is null then null else
      dense_rank() over(order by best_difference_ms asc nulls last, joined_at asc)::integer end as rank
    from member_best
  )
  select rank into v_rank from ranked where nick_key = p_nick_key;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', h.id,
    'team', h.team,
    'elapsedMs', h.client_elapsed_ms,
    'differenceMs', h.difference_ms,
    'verified', h.verified,
    'createdAt', h.created_at
  ) order by h.created_at desc), '[]'::jsonb)
  into v_history
  from (
    select * from public.game_attempts
    where league_id = v_league.id and nick_key = p_nick_key
    order by created_at desc limit 10
  ) h;

  return jsonb_build_object(
    'member', true,
    'code', v_league.code,
    'name', v_league.name,
    'startsAt', v_league.starts_at,
    'endsAt', v_league.ends_at,
    'active', v_league.ends_at > clock_timestamp(),
    'attemptsUsed', v_attempts,
    'attemptsLeft', greatest(0, 5 - v_attempts),
    'maxAttempts', 5,
    'verifiedAttempts', v_verified,
    'bestDifferenceMs', v_best,
    'rank', v_rank,
    'history', v_history
  );
end $$;

create or replace function public.get_game_player_leagues(p_nick_key text)
returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
with memberships as (
  select l.*, owner.nick as owner_nick
  from public.game_league_members mine
  join public.game_leagues l on l.id = mine.league_id
  join public.game_players owner on owner.nick_key = l.owner_nick_key
  where mine.nick_key = p_nick_key
), member_best as (
  select m.league_id, m.nick_key, m.joined_at,
    min(a.difference_ms) filter (where a.verified = true)::integer as best_difference_ms
  from public.game_league_members m
  join memberships l on l.id = m.league_id
  left join public.game_attempts a on a.league_id = m.league_id and a.nick_key = m.nick_key
  group by m.league_id, m.nick_key, m.joined_at
), ranked as (
  select league_id, nick_key, case when best_difference_ms is null then null else
    dense_rank() over(partition by league_id order by best_difference_ms asc nulls last, joined_at asc)::integer end as rank
  from member_best
), summaries as (
  select l.id,
    count(a.id)::integer as attempts_used,
    count(a.id) filter (where a.verified = true)::integer as verified_attempts,
    min(a.difference_ms) filter (where a.verified = true)::integer as best_difference_ms
  from memberships l
  left join public.game_attempts a on a.league_id = l.id and a.nick_key = p_nick_key
  group by l.id
)
select coalesce(jsonb_agg(jsonb_build_object(
  'code', l.code,
  'name', l.name,
  'ownerNick', l.owner_nick,
  'isOwner', l.owner_nick_key = p_nick_key,
  'startsAt', l.starts_at,
  'endsAt', l.ends_at,
  'active', l.ends_at > clock_timestamp(),
  'members', (select count(*)::integer from public.game_league_members m where m.league_id = l.id),
  'attemptsUsed', s.attempts_used,
  'attemptsLeft', greatest(0, 5 - s.attempts_used),
  'maxAttempts', 5,
  'verifiedAttempts', s.verified_attempts,
  'bestDifferenceMs', s.best_difference_ms,
  'rank', r.rank,
  'history', coalesce((select jsonb_agg(jsonb_build_object(
    'id', h.id,
    'team', h.team,
    'elapsedMs', h.client_elapsed_ms,
    'differenceMs', h.difference_ms,
    'verified', h.verified,
    'createdAt', h.created_at
  ) order by h.created_at desc) from (
    select * from public.game_attempts
    where league_id = l.id and nick_key = p_nick_key
    order by created_at desc limit 10
  ) h), '[]'::jsonb)
) order by (l.ends_at > clock_timestamp()) desc, l.ends_at desc, l.created_at desc), '[]'::jsonb)
from memberships l
join summaries s on s.id = l.id
left join ranked r on r.league_id = l.id and r.nick_key = p_nick_key;
$$;

create or replace function public.get_game_daily_awards() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
with today_attempts as (
  select * from public.game_attempts
  where verified = true
    and league_id is null
    and created_at >= date_trunc('day', clock_timestamp())
), best as (
  select nick_key, nick, min(difference_ms)::integer best_difference_ms,
    round(avg(difference_ms))::integer avg_difference_ms,
    count(*)::integer attempts
  from today_attempts group by nick_key, nick
), awards as (
  select
    (select jsonb_build_object('nick',nick,'value',best_difference_ms) from best order by best_difference_ms asc limit 1) golden_boot,
    (select jsonb_build_object('nick',nick,'value',avg_difference_ms) from best where attempts >= 3 order by avg_difference_ms asc limit 1) golden_glove,
    (select jsonb_build_object('nick',nick,'value',attempts) from best order by attempts desc,best_difference_ms asc limit 1) golden_ball
)
select jsonb_build_object('date',current_date,'goldenBoot',golden_boot,'goldenGlove',golden_glove,'goldenBall',golden_ball) from awards;
$$;

revoke all on function public.start_game_challenge(text, text, text, text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.finish_game_attempt(uuid, integer, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.get_game_nick_status(text) from public, anon, authenticated;
revoke all on function public.get_game_player_profile(text) from public, anon, authenticated;
revoke all on function public.get_game_stats() from public, anon, authenticated;
revoke all on function public.create_game_duel(text, text, text) from public, anon, authenticated;
revoke all on function public.resolve_game_duel(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.get_game_league(text) from public, anon, authenticated;
revoke all on function public.get_game_league_player_status(text, text) from public, anon, authenticated;
revoke all on function public.get_game_player_leagues(text) from public, anon, authenticated;
revoke all on function public.get_game_daily_awards() from public, anon, authenticated;

grant execute on function public.start_game_challenge(text, text, text, text, text, uuid, text) to service_role;
grant execute on function public.finish_game_attempt(uuid, integer, text, text, jsonb) to service_role;
grant execute on function public.get_game_nick_status(text) to service_role;
grant execute on function public.get_game_player_profile(text) to service_role;
grant execute on function public.get_game_stats() to service_role;
grant execute on function public.create_game_duel(text, text, text) to service_role;
grant execute on function public.resolve_game_duel(uuid, text, text, text) to service_role;
grant execute on function public.get_game_league(text) to service_role;
grant execute on function public.get_game_league_player_status(text, text) to service_role;
grant execute on function public.get_game_player_leagues(text) to service_role;
grant execute on function public.get_game_daily_awards() to service_role;
