create extension if not exists pgcrypto;

create table if not exists public.game_challenges (
  id uuid primary key default gen_random_uuid(),
  nick text not null check (char_length(nick) between 2 and 24),
  nick_key text not null check (char_length(nick_key) between 2 and 24),
  team text not null check (team in ('spain', 'argentina')),
  device_hash text not null,
  ip_hash text not null,
  started_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp() + interval '30 seconds'),
  consumed_at timestamptz
);

create table if not exists public.game_attempts (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null unique references public.game_challenges(id) on delete restrict,
  nick text not null,
  nick_key text not null,
  team text not null check (team in ('spain', 'argentina')),
  device_hash text not null,
  ip_hash text not null,
  client_elapsed_ms integer not null check (client_elapsed_ms between 500 and 30000),
  server_elapsed_ms integer not null check (server_elapsed_ms between 0 and 60000),
  difference_ms integer not null check (difference_ms >= 0),
  verified boolean not null default true,
  verification_reasons text[] not null default '{}',
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists game_challenges_nick_started_idx on public.game_challenges (nick_key, started_at desc);
create index if not exists game_challenges_device_started_idx on public.game_challenges (device_hash, started_at desc);
create index if not exists game_challenges_ip_started_idx on public.game_challenges (ip_hash, started_at desc);
create index if not exists game_attempts_nick_idx on public.game_attempts (nick_key, created_at desc);
create index if not exists game_attempts_device_idx on public.game_attempts (device_hash, created_at desc);
create index if not exists game_attempts_verified_rank_idx on public.game_attempts (verified, difference_ms, created_at);

alter table public.game_challenges enable row level security;
alter table public.game_attempts enable row level security;
revoke all on table public.game_challenges from anon, authenticated;
revoke all on table public.game_attempts from anon, authenticated;
grant all on table public.game_challenges to service_role;
grant all on table public.game_attempts to service_role;

create or replace function public.start_game_challenge(
  p_nick text,
  p_nick_key text,
  p_team text,
  p_device_hash text,
  p_ip_hash text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempts_used integer;
  v_challenge_id uuid;
begin
  if p_team not in ('spain', 'argentina')
     or char_length(p_nick) not between 2 and 24
     or char_length(p_nick_key) not between 2 and 24 then
    return jsonb_build_object('error', 'invalid_input');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_nick_key, 106));
  select count(*)::integer into v_attempts_used
  from public.game_attempts where nick_key = p_nick_key;

  if v_attempts_used >= 5 then
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

  return jsonb_build_object('challengeId', v_challenge_id, 'attemptsLeft', 5 - v_attempts_used);
end;
$$;

create or replace function public.finish_game_attempt(
  p_challenge_id uuid,
  p_client_elapsed_ms integer,
  p_device_hash text,
  p_ip_hash text
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
  v_attempts_left integer;
  v_attempt_id uuid;
  v_verified boolean := true;
  v_reasons text[] := '{}';
  v_prior_near_perfect integer;
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
  select count(*)::integer into v_attempts_used
  from public.game_attempts where nick_key = v_challenge.nick_key;
  if v_attempts_used >= 5 then return jsonb_build_object('error', 'nick_limit', 'attemptsLeft', 0); end if;

  v_difference_ms := abs(10600 - p_client_elapsed_ms);
  if abs(v_server_elapsed_ms - p_client_elapsed_ms) > 3000 then
    v_verified := false;
    v_reasons := array_append(v_reasons, 'large_network_delta');
  end if;
  if v_challenge.ip_hash <> p_ip_hash then
    v_verified := false;
    v_reasons := array_append(v_reasons, 'ip_changed_during_attempt');
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
    client_elapsed_ms, server_elapsed_ms, difference_ms, verified, verification_reasons
  ) values (
    v_challenge.id, v_challenge.nick, v_challenge.nick_key, v_challenge.team,
    v_challenge.device_hash, p_ip_hash, p_client_elapsed_ms, v_server_elapsed_ms,
    v_difference_ms, v_verified, v_reasons
  ) returning id into v_attempt_id;

  v_attempts_left := 5 - v_attempts_used - 1;
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
    'attemptsLeft', v_attempts_left
  );
end;
$$;

create or replace function public.get_game_nick_status(p_nick_key text)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'attemptsUsed', count(*)::integer,
    'attemptsLeft', greatest(0, 5 - count(*)::integer)
  ) from public.game_attempts where nick_key = p_nick_key;
$$;

create or replace function public.get_game_stats()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
with best as (
  select distinct on (team, nick_key)
    id, nick, nick_key, team, client_elapsed_ms, difference_ms, created_at
  from public.game_attempts
  where verified = true
  order by team, nick_key, difference_ms asc, created_at asc
),
team_list(team) as (values ('spain'::text), ('argentina'::text)),
team_stats as (
  select teams.team,
    (select count(*)::integer from public.game_attempts a where a.team = teams.team) as attempts,
    count(best.id)::integer as players,
    case when count(best.id) > 0 then round(avg(best.difference_ms))::integer else null end as average_difference_ms,
    coalesce(sum(greatest(1, 1000 - best.difference_ms)), 0)::bigint as score
  from team_list teams left join best on best.team = teams.team group by teams.team
),
leaderboard as (
  select * from best order by difference_ms asc, created_at asc limit 20
)
select jsonb_build_object(
  'targetMs', 10600,
  'maxAttemptsPerNick', 5,
  'totalAttempts', (select count(*)::integer from public.game_attempts),
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

revoke all on function public.start_game_challenge(text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.finish_game_attempt(uuid, integer, text, text) from public, anon, authenticated;
revoke all on function public.get_game_nick_status(text) from public, anon, authenticated;
revoke all on function public.get_game_stats() from public, anon, authenticated;
grant execute on function public.start_game_challenge(text, text, text, text, text) to service_role;
grant execute on function public.finish_game_attempt(uuid, integer, text, text) to service_role;
grant execute on function public.get_game_nick_status(text) to service_role;
grant execute on function public.get_game_stats() to service_role;
