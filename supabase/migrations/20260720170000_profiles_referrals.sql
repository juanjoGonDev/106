alter table public.game_attempts
  add column if not exists client_signals jsonb not null default '{}'::jsonb;

create table if not exists public.game_players (
  nick_key text primary key,
  nick text not null check (char_length(nick) between 2 and 24),
  referral_code uuid not null default gen_random_uuid() unique,
  first_device_hash text not null,
  first_ip_hash text not null,
  created_at timestamptz not null default clock_timestamp()
);

create table if not exists public.game_player_bonus (
  nick_key text primary key references public.game_players(nick_key) on delete cascade,
  bonus_attempts integer not null default 0 check (bonus_attempts >= 0),
  updated_at timestamptz not null default clock_timestamp()
);

create table if not exists public.game_referrals (
  id uuid primary key default gen_random_uuid(),
  referral_code uuid not null,
  referrer_nick_key text not null references public.game_players(nick_key) on delete cascade,
  referred_nick_key text not null unique references public.game_players(nick_key) on delete cascade,
  referred_device_hash text not null,
  referred_ip_hash text not null,
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  check (referrer_nick_key <> referred_nick_key)
);

create index if not exists game_referrals_referrer_idx on public.game_referrals(referrer_nick_key, completed_at);

alter table public.game_players enable row level security;
alter table public.game_player_bonus enable row level security;
alter table public.game_referrals enable row level security;
revoke all on table public.game_players, public.game_player_bonus, public.game_referrals from anon, authenticated;
grant all on table public.game_players, public.game_player_bonus, public.game_referrals to service_role;

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

  insert into public.game_challenges (nick, nick_key, team, device_hash, ip_hash)
  values (p_nick, p_nick_key, p_team, p_device_hash, p_ip_hash)
  returning id into v_challenge_id;

  return jsonb_build_object(
    'challengeId', v_challenge_id,
    'attemptsLeft', v_max_attempts - v_attempts_used,
    'maxAttempts', v_max_attempts
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
  if coalesce((p_client_signals->>'trustedStart')::boolean, false) = false
     or coalesce((p_client_signals->>'trustedFinish')::boolean, false) = false
     or coalesce((p_client_signals->>'timerConcealed')::boolean, false) = false then
    v_verified := false;
    v_reasons := array_append(v_reasons, 'invalid_client_interaction');
  end if;
  if coalesce((p_client_signals->>'visibilityChanges')::integer, 0) > 0
     or coalesce((p_client_signals->>'focusLosses')::integer, 0) > 0 then
    v_verified := false;
    v_reasons := array_append(v_reasons, 'focus_changed_during_attempt');
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

create or replace function public.get_game_player_profile(p_nick_key text)
returns jsonb
language sql stable security definer set search_path = public, pg_temp
as $$
with player_attempts as (
  select * from public.game_attempts where nick_key = p_nick_key
), verified_attempts as (
  select * from player_attempts where verified = true
), player_summary as (
  select
    count(*)::integer as verified_count,
    round(avg(difference_ms))::integer as average_difference_ms,
    min(difference_ms)::integer as best_difference_ms
  from verified_attempts
), all_summaries as (
  select nick_key,
    round(avg(difference_ms))::integer as average_difference_ms,
    min(difference_ms)::integer as best_difference_ms
  from public.game_attempts where verified = true
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
    'differenceMs', a.difference_ms, 'verified', a.verified, 'createdAt', a.created_at
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
  where verified = true
  order by team, nick_key, difference_ms asc, created_at asc
), team_list(team) as (values ('spain'::text), ('argentina'::text)),
team_stats as (
  select teams.team,
    (select count(*)::integer from public.game_attempts a where a.team = teams.team) as attempts,
    count(best.id)::integer as players,
    case when count(best.id) > 0 then round(avg(best.difference_ms))::integer else null end as average_difference_ms,
    coalesce(sum(greatest(1, 1000 - best.difference_ms)), 0)::bigint as score
  from team_list teams left join best on best.team = teams.team group by teams.team
), leaderboard as (
  select * from best order by difference_ms asc, created_at asc limit 10
)
select jsonb_build_object(
  'targetMs', 10600,
  'maxAttemptsPerNick', 5,
  'totalAttempts', (select count(*)::integer from public.game_attempts),
  'verifiedAttempts', (select count(*)::integer from public.game_attempts where verified = true),
  'totalPlayers', (select count(distinct nick_key)::integer from public.game_attempts where verified = true),
  'perfectAttempts', (select count(*)::integer from public.game_attempts where verified = true and difference_ms = 0),
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

revoke all on function public.start_game_challenge(text, text, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.finish_game_attempt(uuid, integer, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.get_game_player_profile(text) from public, anon, authenticated;
revoke all on function public.get_game_stats() from public, anon, authenticated;
grant execute on function public.start_game_challenge(text, text, text, text, text, uuid) to service_role;
grant execute on function public.finish_game_attempt(uuid, integer, text, text, jsonb) to service_role;
grant execute on function public.get_game_player_profile(text) to service_role;
grant execute on function public.get_game_stats() to service_role;
