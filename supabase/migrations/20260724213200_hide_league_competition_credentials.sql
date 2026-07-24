-- production-data-loss-approved: replaces a non-data check constraint while moving the private credential to join_code; no rows or columns are removed.

alter table public.game_leagues
  add column if not exists join_code text;

update public.game_leagues
set join_code = code
where join_code is null;

alter table public.game_leagues
  alter column join_code set not null;

create unique index if not exists game_leagues_join_code_key
  on public.game_leagues(join_code);

alter table public.game_leagues
  drop constraint if exists game_leagues_private_public_distinct_check;

update public.game_leagues
set code = public_id
where code <> public_id;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'game_leagues_join_public_distinct_check'
      and conrelid = 'public.game_leagues'::regclass
  ) then
    alter table public.game_leagues
      add constraint game_leagues_join_public_distinct_check
      check (join_code <> public_id);
  end if;
end;
$$;

create or replace function public.generate_game_league_token()
returns text
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_token text;
  v_random_bytes bytea;
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  loop
    v_random_bytes := extensions.gen_random_bytes(6);
    select string_agg(
      substr(v_alphabet, (get_byte(v_random_bytes, byte_index) % 32) + 1, 1),
      '' order by byte_index
    ) into v_token
    from generate_series(0, 5) as byte_index;

    exit when not exists (
      select 1
      from public.game_leagues league
      where league.code = v_token
         or league.public_id = v_token
         or league.join_code = v_token
    );
  end loop;

  return v_token;
end;
$$;

create or replace function public.create_game_league(
  p_name text,
  p_owner_nick_key text,
  p_device_hash text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_public_id text;
  v_join_code text;
  v_account_id uuid;
  v_identity_device_hash text;
begin
  if char_length(trim(p_name)) not between 3 and 40 then
    return jsonb_build_object('error', 'invalid_league_name');
  end if;

  select account_player.account_id, player.first_device_hash
  into v_account_id, v_identity_device_hash
  from public.game_account_players account_player
  join public.game_players player on player.nick_key = account_player.nick_key
  where account_player.nick_key = p_owner_nick_key;

  if v_account_id is null or v_identity_device_hash is null then
    return jsonb_build_object('error', 'player_access_denied');
  end if;

  if (
    select count(*)
    from public.game_leagues
    where owner_nick_key = p_owner_nick_key
      and created_at > clock_timestamp() - interval '7 days'
  ) >= 3 then
    return jsonb_build_object('error', 'league_limit');
  end if;

  v_public_id := public.generate_game_league_token();
  v_join_code := public.generate_game_league_token();
  while v_join_code = v_public_id loop
    v_join_code := public.generate_game_league_token();
  end loop;

  insert into public.game_leagues(
    code,
    public_id,
    join_code,
    name,
    owner_nick_key,
    owner_device_hash,
    starts_at,
    ends_at,
    activated_at
  ) values (
    v_public_id,
    v_public_id,
    v_join_code,
    trim(p_name),
    p_owner_nick_key,
    p_device_hash,
    clock_timestamp(),
    clock_timestamp(),
    null
  ) returning id into v_id;

  insert into public.game_league_members(league_id, nick_key, account_id, device_hash)
  values (v_id, p_owner_nick_key, v_account_id, v_identity_device_hash)
  on conflict (league_id, nick_key) do nothing;

  return jsonb_build_object(
    'publicId', v_public_id,
    'joinCode', v_join_code,
    'name', trim(p_name)
  ) || public.activate_game_league_if_eligible(v_id);
end;
$$;

create or replace function public.join_game_league(
  p_code text,
  p_nick_key text,
  p_device_hash text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_league public.game_leagues%rowtype;
  v_account_id uuid;
  v_identity_device_hash text;
  v_state jsonb;
begin
  select * into v_league
  from public.game_leagues
  where join_code = upper(trim(p_code))
  for update;

  if not found then return jsonb_build_object('error', 'league_not_found'); end if;
  if v_league.activated_at is not null and v_league.ends_at <= clock_timestamp() then
    return jsonb_build_object('error', 'league_finished');
  end if;

  select account_player.account_id, player.first_device_hash
  into v_account_id, v_identity_device_hash
  from public.game_account_players account_player
  join public.game_players player on player.nick_key = account_player.nick_key
  where account_player.nick_key = p_nick_key;

  if v_account_id is null or v_identity_device_hash is null then
    return jsonb_build_object('error', 'player_access_denied');
  end if;

  insert into public.game_league_members(league_id, nick_key, account_id, device_hash)
  values (v_league.id, p_nick_key, v_account_id, v_identity_device_hash)
  on conflict (league_id, nick_key) do update
    set account_id = coalesce(public.game_league_members.account_id, excluded.account_id),
        device_hash = coalesce(public.game_league_members.device_hash, excluded.device_hash);

  v_state := public.activate_game_league_if_eligible(v_league.id);
  return jsonb_build_object(
    'publicId', v_league.public_id,
    'name', v_league.name
  ) || v_state;
end;
$$;

create or replace function public.join_game_league(p_code text, p_nick_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_device_hash text;
begin
  select player.first_device_hash into v_identity_device_hash
  from public.game_players player
  where player.nick_key = p_nick_key;

  if v_identity_device_hash is null then
    return jsonb_build_object('error', 'player_access_denied');
  end if;

  return public.join_game_league(p_code, p_nick_key, v_identity_device_hash);
end;
$$;

create or replace function public.get_game_player_league_competition_code(
  p_public_id text,
  p_nick_key text
) returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select league.public_id
  from public.game_leagues league
  join public.game_league_members member on member.league_id = league.id
  where league.public_id = upper(trim(p_public_id))
    and member.nick_key = p_nick_key
    and league.activated_at is not null
    and league.ends_at > clock_timestamp();
$$;

create or replace function public.get_game_league_player_status_by_public_id(
  p_public_id text,
  p_nick_key text
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1
    from public.game_leagues league
    join public.game_league_members member on member.league_id = league.id
    where league.public_id = upper(trim(p_public_id))
      and member.nick_key = p_nick_key
  ) then
    return jsonb_build_object('error', 'league_membership_required');
  end if;

  return public.get_game_league_player_status(upper(trim(p_public_id)), p_nick_key);
end;
$$;

create or replace function public.get_game_player_leagues(p_nick_key text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
with memberships as (
  select league.*, owner.nick as owner_nick
  from public.game_league_members mine
  join public.game_leagues league on league.id = mine.league_id
  join public.game_players owner on owner.nick_key = league.owner_nick_key
  where mine.nick_key = p_nick_key
), member_best as (
  select member.league_id, member.nick_key, member.joined_at,
    min(attempt.difference_ms) filter (where attempt.verified = true)::integer as best_difference_ms,
    min(attempt.created_at) filter (where attempt.verified = true)::timestamptz as best_at
  from public.game_league_members member
  join memberships league on league.id = member.league_id
  left join public.game_attempts attempt
    on attempt.league_id = member.league_id and attempt.nick_key = member.nick_key
  group by member.league_id, member.nick_key, member.joined_at
), ranked as (
  select league_id, nick_key, case when best_difference_ms is null then null else
    row_number() over(partition by league_id order by best_difference_ms, best_at, joined_at, nick_key)::integer end as rank
  from member_best
), summaries as (
  select league.id,
    count(attempt.id)::integer as attempts_used,
    count(attempt.id) filter (where attempt.verified = true)::integer as verified_attempts,
    min(attempt.difference_ms) filter (where attempt.verified = true)::integer as best_difference_ms
  from memberships league
  left join public.game_attempts attempt on attempt.league_id = league.id and attempt.nick_key = p_nick_key
  group by league.id
)
select coalesce(jsonb_agg(
  jsonb_build_object(
    'publicId', league.public_id,
    'competitionCode', league.public_id,
    'joinCode', case when league.owner_nick_key = p_nick_key then league.join_code else null end,
    'name', league.name,
    'ownerNick', league.owner_nick,
    'isOwner', league.owner_nick_key = p_nick_key,
    'createdAt', league.created_at,
    'members', (select count(*)::integer from public.game_league_members member where member.league_id = league.id),
    'attemptsUsed', summary.attempts_used,
    'attemptsLeft', greatest(0, 5 - summary.attempts_used),
    'maxAttempts', 5,
    'verifiedAttempts', summary.verified_attempts,
    'bestDifferenceMs', summary.best_difference_ms,
    'rank', ranked.rank,
    'revision', floor(extract(epoch from coalesce((
      select max(changed_at)
      from (
        select league.created_at as changed_at
        union all select league.activated_at where league.activated_at is not null
        union all select member.joined_at from public.game_league_members member where member.league_id = league.id
        union all select attempt.created_at from public.game_attempts attempt where attempt.league_id = league.id
        union all select trophy.awarded_at from public.game_league_trophies trophy where trophy.league_id = league.id
      ) changes
    ), league.created_at)) * 1000)::bigint,
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', history.id,
        'team', history.team,
        'elapsedMs', history.client_elapsed_ms,
        'differenceMs', history.difference_ms,
        'verified', history.verified,
        'createdAt', history.created_at
      ) order by history.created_at desc)
      from (
        select * from public.game_attempts
        where league_id = league.id and nick_key = p_nick_key
        order by created_at desc limit 10
      ) history
    ), '[]'::jsonb)
  ) || public.get_game_league_status(league.id)
  order by (league.activated_at is null) desc,
    (league.activated_at is not null and league.ends_at > clock_timestamp()) desc,
    league.created_at desc
), '[]'::jsonb)
from memberships league
join summaries summary on summary.id = league.id
left join ranked on ranked.league_id = league.id and ranked.nick_key = p_nick_key;
$$;

revoke all on function public.generate_game_league_token() from public, anon, authenticated;
revoke all on function public.create_game_league(text, text, text) from public, anon, authenticated;
revoke all on function public.join_game_league(text, text, text) from public, anon, authenticated;
revoke all on function public.join_game_league(text, text) from public, anon, authenticated;
revoke all on function public.get_game_player_league_competition_code(text, text) from public, anon, authenticated;
revoke all on function public.get_game_league_player_status_by_public_id(text, text) from public, anon, authenticated;
revoke all on function public.get_game_player_leagues(text) from public, anon, authenticated;

grant execute on function public.generate_game_league_token() to service_role;
grant execute on function public.create_game_league(text, text, text) to service_role;
grant execute on function public.join_game_league(text, text, text) to service_role;
grant execute on function public.join_game_league(text, text) to service_role;
grant execute on function public.get_game_player_league_competition_code(text, text) to service_role;
grant execute on function public.get_game_league_player_status_by_public_id(text, text) to service_role;
grant execute on function public.get_game_player_leagues(text) to service_role;
