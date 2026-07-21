create table if not exists public.game_duels (
  id uuid primary key default gen_random_uuid(),
  code uuid not null default gen_random_uuid() unique,
  challenger_nick_key text not null references public.game_players(nick_key) on delete cascade,
  challenger_best_difference_ms integer not null check (challenger_best_difference_ms >= 0),
  challenger_device_hash text not null,
  challenger_ip_hash text not null,
  opponent_nick_key text references public.game_players(nick_key) on delete set null,
  opponent_device_hash text,
  opponent_ip_hash text,
  opponent_best_difference_ms integer,
  status text not null default 'open' check (status in ('open','won','lost','expired')),
  reward_granted boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp() + interval '3 days'),
  completed_at timestamptz
);

create table if not exists public.game_leagues (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{6}$'),
  name text not null check (char_length(name) between 3 and 40),
  owner_nick_key text not null references public.game_players(nick_key) on delete cascade,
  owner_device_hash text not null,
  created_at timestamptz not null default clock_timestamp(),
  starts_at timestamptz not null default clock_timestamp(),
  ends_at timestamptz not null default (clock_timestamp() + interval '3 days')
);

create table if not exists public.game_league_members (
  league_id uuid not null references public.game_leagues(id) on delete cascade,
  nick_key text not null references public.game_players(nick_key) on delete cascade,
  joined_at timestamptz not null default clock_timestamp(),
  primary key (league_id, nick_key)
);

create index if not exists game_duels_code_idx on public.game_duels(code);
create index if not exists game_duels_challenger_idx on public.game_duels(challenger_nick_key, created_at desc);
create index if not exists game_leagues_code_idx on public.game_leagues(code);
create index if not exists game_league_members_nick_idx on public.game_league_members(nick_key, joined_at desc);

alter table public.game_duels enable row level security;
alter table public.game_leagues enable row level security;
alter table public.game_league_members enable row level security;
revoke all on table public.game_duels, public.game_leagues, public.game_league_members from anon, authenticated;
grant all on table public.game_duels, public.game_leagues, public.game_league_members to service_role;

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
  select min(difference_ms) into v_best from public.game_attempts where nick_key = p_nick_key and verified = true;
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
  select min(difference_ms) into v_best from public.game_attempts where nick_key = p_opponent_nick_key and verified = true and created_at >= v_duel.created_at;
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

create or replace function public.create_game_league(
  p_name text,
  p_owner_nick_key text,
  p_device_hash text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
  v_code text;
begin
  if char_length(trim(p_name)) not between 3 and 40 then return jsonb_build_object('error','invalid_league_name'); end if;
  if (select count(*) from public.game_leagues where owner_nick_key = p_owner_nick_key and created_at > clock_timestamp() - interval '7 days') >= 3 then
    return jsonb_build_object('error','league_limit');
  end if;
  loop
    v_code := upper(substr(encode(gen_random_bytes(6),'hex'),1,6));
    exit when not exists(select 1 from public.game_leagues where code = v_code);
  end loop;
  insert into public.game_leagues(code,name,owner_nick_key,owner_device_hash) values(v_code,trim(p_name),p_owner_nick_key,p_device_hash) returning id into v_id;
  insert into public.game_league_members(league_id,nick_key) values(v_id,p_owner_nick_key) on conflict do nothing;
  return jsonb_build_object('code',v_code,'name',trim(p_name),'endsAt',clock_timestamp() + interval '3 days');
end $$;

create or replace function public.join_game_league(p_code text, p_nick_key text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_league public.game_leagues%rowtype;
begin
  select * into v_league from public.game_leagues where code = upper(trim(p_code));
  if not found then return jsonb_build_object('error','league_not_found'); end if;
  if v_league.ends_at <= clock_timestamp() then return jsonb_build_object('error','league_finished'); end if;
  insert into public.game_league_members(league_id,nick_key) values(v_league.id,p_nick_key) on conflict do nothing;
  return jsonb_build_object('code',v_league.code,'name',v_league.name,'endsAt',v_league.ends_at);
end $$;

create or replace function public.get_game_league(p_code text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
with l as (select * from public.game_leagues where code = upper(trim(p_code))), ranked as (
  select m.nick_key,p.nick,min(a.difference_ms)::integer best_difference_ms,
    dense_rank() over(order by min(a.difference_ms) asc nulls last)::integer as rank
  from l join public.game_league_members m on m.league_id=l.id join public.game_players p on p.nick_key=m.nick_key
  left join public.game_attempts a on a.nick_key=m.nick_key and a.verified=true and a.created_at between l.starts_at and l.ends_at
  group by m.nick_key,p.nick
)
select coalesce((select jsonb_build_object('code',l.code,'name',l.name,'startsAt',l.starts_at,'endsAt',l.ends_at,
  'members',(select count(*) from ranked),'leaderboard',coalesce((select jsonb_agg(jsonb_build_object('nick',nick,'rank',rank,'bestDifferenceMs',best_difference_ms) order by rank,nick) from ranked),'[]'::jsonb)) from l),'{}'::jsonb);
$$;

create or replace function public.get_game_daily_awards() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
with today_attempts as (
  select * from public.game_attempts where verified=true and created_at >= date_trunc('day',clock_timestamp())
), best as (
  select nick_key,nick,min(difference_ms)::integer best_difference_ms,round(avg(difference_ms))::integer avg_difference_ms,count(*)::integer attempts
  from today_attempts group by nick_key,nick
), awards as (
  select
    (select jsonb_build_object('nick',nick,'value',best_difference_ms) from best order by best_difference_ms asc limit 1) golden_boot,
    (select jsonb_build_object('nick',nick,'value',avg_difference_ms) from best where attempts>=3 order by avg_difference_ms asc limit 1) golden_glove,
    (select jsonb_build_object('nick',nick,'value',attempts) from best order by attempts desc,best_difference_ms asc limit 1) golden_ball
)
select jsonb_build_object('date',current_date,'goldenBoot',golden_boot,'goldenGlove',golden_glove,'goldenBall',golden_ball) from awards;
$$;

revoke all on function public.create_game_duel(text,text,text) from public,anon,authenticated;
revoke all on function public.resolve_game_duel(uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.create_game_league(text,text,text) from public,anon,authenticated;
revoke all on function public.join_game_league(text,text) from public,anon,authenticated;
revoke all on function public.get_game_league(text) from public,anon,authenticated;
revoke all on function public.get_game_daily_awards() from public,anon,authenticated;
grant execute on function public.create_game_duel(text,text,text) to service_role;
grant execute on function public.resolve_game_duel(uuid,text,text,text) to service_role;
grant execute on function public.create_game_league(text,text,text) to service_role;
grant execute on function public.join_game_league(text,text) to service_role;
grant execute on function public.get_game_league(text) to service_role;
grant execute on function public.get_game_daily_awards() to service_role;