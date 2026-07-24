alter table public.game_leagues
  add column if not exists activated_at timestamptz;

alter table public.game_league_members
  add column if not exists account_id uuid references public.game_accounts(id) on delete restrict,
  add column if not exists device_hash text;

update public.game_league_members member
set account_id = account_player.account_id,
    device_hash = coalesce(member.device_hash, player.first_device_hash, league.owner_device_hash)
from public.game_leagues league
join public.game_players player on player.nick_key = member.nick_key
left join public.game_account_players account_player on account_player.nick_key = member.nick_key
where league.id = member.league_id
  and (member.account_id is null or member.device_hash is null);

update public.game_leagues
set activated_at = starts_at
where activated_at is null;

create index if not exists game_league_members_activation_idx
  on public.game_league_members(league_id, account_id, device_hash);

create index if not exists game_leagues_activation_idx
  on public.game_leagues(activated_at, ends_at);

create table if not exists public.game_league_trophies (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null unique references public.game_leagues(id) on delete restrict,
  nick_key text not null references public.game_players(nick_key) on delete cascade,
  winning_attempt_id uuid not null references public.game_attempts(id) on delete restrict,
  best_difference_ms integer not null check (best_difference_ms >= 0),
  participant_count integer not null check (participant_count >= 3),
  owner_count integer not null check (owner_count >= 3),
  device_count integer not null check (device_count >= 3),
  awarded_at timestamptz not null default clock_timestamp()
);

create index if not exists game_league_trophies_player_date_idx
  on public.game_league_trophies(nick_key, awarded_at desc);

alter table public.game_league_trophies enable row level security;
revoke all on table public.game_league_trophies from public, anon, authenticated;
grant all on table public.game_league_trophies to service_role;

create or replace function public.get_game_league_activation(p_code text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with selected_league as (
    select league.*
    from public.game_leagues league
    where league.code = upper(trim(p_code))
  ), eligibility as (
    select
      count(*)::integer as participant_count,
      count(distinct member.account_id) filter (where member.account_id is not null)::integer as owner_count,
      count(distinct member.device_hash) filter (where member.device_hash is not null)::integer as device_count
    from selected_league league
    left join public.game_league_members member on member.league_id = league.id
  )
  select coalesce((
    select jsonb_build_object(
      'active', league.activated_at is not null and league.ends_at > clock_timestamp(),
      'waiting', league.activated_at is null,
      'finished', league.activated_at is not null and league.ends_at <= clock_timestamp(),
      'activatedAt', league.activated_at,
      'startsAt', case when league.activated_at is null then null else league.starts_at end,
      'endsAt', case when league.activated_at is null then null else league.ends_at end,
      'requiredParticipants', 3,
      'participantCount', eligibility.participant_count,
      'eligibleOwners', eligibility.owner_count,
      'eligibleDevices', eligibility.device_count,
      'participantsNeeded', greatest(0, 3 - eligibility.owner_count, 3 - eligibility.device_count)
    )
    from selected_league league
    cross join eligibility
  ), '{}'::jsonb);
$$;

create or replace function public.activate_game_league_if_eligible(p_league_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_league public.game_leagues%rowtype;
  v_participant_count integer;
  v_owner_count integer;
  v_device_count integer;
  v_now timestamptz := clock_timestamp();
begin
  select * into v_league
  from public.game_leagues
  where id = p_league_id
  for update;

  if not found then
    return jsonb_build_object('error', 'league_not_found');
  end if;

  select
    count(*)::integer,
    count(distinct account_id) filter (where account_id is not null)::integer,
    count(distinct device_hash) filter (where device_hash is not null)::integer
  into v_participant_count, v_owner_count, v_device_count
  from public.game_league_members
  where league_id = p_league_id;

  if v_league.activated_at is null
     and v_owner_count >= 3
     and v_device_count >= 3 then
    update public.game_leagues
    set activated_at = v_now,
        starts_at = v_now,
        ends_at = v_now + interval '3 days'
    where id = p_league_id
    returning * into v_league;
  end if;

  return jsonb_build_object(
    'active', v_league.activated_at is not null and v_league.ends_at > v_now,
    'waiting', v_league.activated_at is null,
    'finished', v_league.activated_at is not null and v_league.ends_at <= v_now,
    'activatedAt', v_league.activated_at,
    'startsAt', case when v_league.activated_at is null then null else v_league.starts_at end,
    'endsAt', case when v_league.activated_at is null then null else v_league.ends_at end,
    'requiredParticipants', 3,
    'participantCount', v_participant_count,
    'eligibleOwners', v_owner_count,
    'eligibleDevices', v_device_count,
    'participantsNeeded', greatest(0, 3 - v_owner_count, 3 - v_device_count)
  );
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
  v_code text;
  v_random_bytes bytea;
  v_account_id uuid;
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  if char_length(trim(p_name)) not between 3 and 40 then
    return jsonb_build_object('error', 'invalid_league_name');
  end if;

  select account_player.account_id into v_account_id
  from public.game_account_players account_player
  where account_player.nick_key = p_owner_nick_key;

  if v_account_id is null then
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

  loop
    v_random_bytes := extensions.gen_random_bytes(6);
    select string_agg(
      substr(v_alphabet, (get_byte(v_random_bytes, byte_index) % 32) + 1, 1),
      '' order by byte_index
    ) into v_code
    from generate_series(0, 5) as byte_index;
    exit when not exists (select 1 from public.game_leagues where code = v_code);
  end loop;

  insert into public.game_leagues(
    code,
    name,
    owner_nick_key,
    owner_device_hash,
    starts_at,
    ends_at,
    activated_at
  ) values (
    v_code,
    trim(p_name),
    p_owner_nick_key,
    p_device_hash,
    clock_timestamp(),
    clock_timestamp(),
    null
  ) returning id into v_id;

  insert into public.game_league_members(league_id, nick_key, account_id, device_hash)
  values (v_id, p_owner_nick_key, v_account_id, p_device_hash)
  on conflict (league_id, nick_key) do update
    set account_id = excluded.account_id,
        device_hash = excluded.device_hash;

  return jsonb_build_object(
    'code', v_code,
    'name', trim(p_name),
    'active', false,
    'waiting', true,
    'startsAt', null,
    'endsAt', null,
    'requiredParticipants', 3,
    'participantCount', 1,
    'eligibleOwners', 1,
    'eligibleDevices', 1,
    'participantsNeeded', 2
  );
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
  v_activation jsonb;
begin
  select * into v_league
  from public.game_leagues
  where code = upper(trim(p_code))
  for update;

  if not found then return jsonb_build_object('error', 'league_not_found'); end if;
  if v_league.activated_at is not null and v_league.ends_at <= clock_timestamp() then
    return jsonb_build_object('error', 'league_finished');
  end if;

  select account_player.account_id into v_account_id
  from public.game_account_players account_player
  where account_player.nick_key = p_nick_key;

  if v_account_id is null then
    return jsonb_build_object('error', 'player_access_denied');
  end if;

  insert into public.game_league_members(league_id, nick_key, account_id, device_hash)
  values (v_league.id, p_nick_key, v_account_id, p_device_hash)
  on conflict (league_id, nick_key) do update
    set account_id = excluded.account_id,
        device_hash = excluded.device_hash;

  v_activation := public.activate_game_league_if_eligible(v_league.id);

  return jsonb_build_object('code', v_league.code, 'name', v_league.name) || v_activation;
end;
$$;

create or replace function public.join_game_league(p_code text, p_nick_key text)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object('error', 'league_device_required');
$$;

create or replace function public.get_game_league_with_activation(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_league jsonb;
begin
  v_league := public.get_game_league(p_code);
  if coalesce(v_league->>'code', '') = '' then
    return v_league;
  end if;
  return v_league || public.get_game_league_activation(p_code);
end;
$$;

create or replace function public.get_game_player_leagues_with_activation(p_nick_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_leagues jsonb;
  v_result jsonb;
begin
  v_leagues := coalesce(public.get_game_player_leagues(p_nick_key), '[]'::jsonb);

  select coalesce(jsonb_agg(
    league || public.get_game_league_activation(league->>'code')
    order by coalesce((league->>'createdAt')::timestamptz, '-infinity'::timestamptz) desc
  ), '[]'::jsonb)
  into v_result
  from jsonb_array_elements(v_leagues) league;

  return v_result;
end;
$$;

create or replace function public.start_eligible_game_challenge_pointer_only(
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
  v_league public.game_leagues%rowtype;
begin
  if nullif(trim(coalesce(p_league_code, '')), '') is not null then
    select * into v_league
    from public.game_leagues
    where code = upper(trim(p_league_code));

    if not found then return jsonb_build_object('error', 'league_not_found'); end if;
    if v_league.activated_at is null then
      return jsonb_build_object('error', 'league_waiting') || public.get_game_league_activation(v_league.code);
    end if;
    if v_league.ends_at <= clock_timestamp() then
      return jsonb_build_object('error', 'league_finished');
    end if;
  end if;

  return public.start_game_challenge_pointer_only(
    p_nick => p_nick,
    p_nick_key => p_nick_key,
    p_team => p_team,
    p_device_hash => p_device_hash,
    p_ip_hash => p_ip_hash,
    p_referral_code => p_referral_code,
    p_league_code => p_league_code
  );
end;
$$;

create or replace function public.sync_game_league_trophies()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_league record;
  v_winner record;
  v_participant_count integer;
  v_owner_count integer;
  v_device_count integer;
  v_inserted integer := 0;
begin
  for v_league in
    select league.id, league.code, league.name, league.ends_at
    from public.game_leagues league
    where league.activated_at is not null
      and league.ends_at <= clock_timestamp()
      and not exists (
        select 1 from public.game_league_trophies trophy where trophy.league_id = league.id
      )
    order by league.ends_at, league.id
  loop
    perform pg_advisory_xact_lock(hashtextextended(v_league.id::text, 106));

    if exists (select 1 from public.game_league_trophies where league_id = v_league.id) then
      continue;
    end if;

    select
      count(*)::integer,
      count(distinct account_id) filter (where account_id is not null)::integer,
      count(distinct device_hash) filter (where device_hash is not null)::integer
    into v_participant_count, v_owner_count, v_device_count
    from public.game_league_members
    where league_id = v_league.id;

    if v_owner_count < 3 or v_device_count < 3 then
      continue;
    end if;

    select attempt.id, attempt.nick_key, attempt.difference_ms
    into v_winner
    from public.game_attempts attempt
    where attempt.league_id = v_league.id
      and attempt.verified = true
    order by attempt.difference_ms, attempt.created_at, attempt.nick_key, attempt.id
    limit 1;

    if not found then
      continue;
    end if;

    insert into public.game_league_trophies(
      league_id,
      nick_key,
      winning_attempt_id,
      best_difference_ms,
      participant_count,
      owner_count,
      device_count
    ) values (
      v_league.id,
      v_winner.nick_key,
      v_winner.id,
      v_winner.difference_ms,
      v_participant_count,
      v_owner_count,
      v_device_count
    ) on conflict (league_id) do nothing;

    if found then
      v_inserted := v_inserted + 1;
    end if;
  end loop;

  return v_inserted;
end;
$$;

create or replace function public.get_game_profile_revision(p_nick_key text)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select floor(extract(epoch from coalesce(max(change.changed_at), 'epoch'::timestamptz)) * 1000)::bigint
  from (
    select attempt.created_at as changed_at
    from public.game_attempts attempt
    where attempt.nick_key = p_nick_key and attempt.league_id is null
    union all
    select bonus.updated_at
    from public.game_player_bonus bonus
    where bonus.nick_key = p_nick_key
    union all
    select referral.completed_at
    from public.game_referrals referral
    where referral.referrer_nick_key = p_nick_key and referral.completed_at is not null
    union all
    select trophy.awarded_at
    from public.game_daily_trophies trophy
    where trophy.nick_key = p_nick_key
    union all
    select achievement.awarded_at
    from public.game_player_achievements achievement
    where achievement.nick_key = p_nick_key
    union all
    select trophy.awarded_at
    from public.game_league_trophies trophy
    where trophy.nick_key = p_nick_key
  ) change;
$$;

create or replace function public.get_game_public_profile(p_nick_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile jsonb;
  v_team text;
  v_revision bigint;
  v_daily_trophies integer;
  v_league_trophies integer;
  v_league_history jsonb;
begin
  perform public.sync_game_league_trophies();
  v_profile := public.get_game_player_profile(p_nick_key);

  select attempt.team into v_team
  from public.game_attempts attempt
  where attempt.nick_key = p_nick_key
    and attempt.verified = true
    and attempt.league_id is null
  order by attempt.created_at desc, attempt.id desc
  limit 1;

  select count(*)::integer,
    coalesce(jsonb_agg(jsonb_build_object(
      'type', 'league_champion',
      'date', (league.ends_at at time zone 'Europe/Madrid')::date,
      'value', trophy.best_difference_ms,
      'leagueCode', league.code,
      'leagueName', league.name,
      'participants', trophy.participant_count,
      'awardedAt', trophy.awarded_at
    ) order by trophy.awarded_at desc, league.code), '[]'::jsonb)
  into v_league_trophies, v_league_history
  from public.game_league_trophies trophy
  join public.game_leagues league on league.id = trophy.league_id
  where trophy.nick_key = p_nick_key;

  v_daily_trophies := coalesce((v_profile #>> '{trophies,total}')::integer, 0);
  v_profile := jsonb_set(v_profile, '{trophies,dailyTotal}', to_jsonb(v_daily_trophies), true);
  v_profile := jsonb_set(v_profile, '{trophies,leagueChampion}', to_jsonb(coalesce(v_league_trophies, 0)), true);
  v_profile := jsonb_set(v_profile, '{trophies,total}', to_jsonb(v_daily_trophies + coalesce(v_league_trophies, 0)), true);

  v_revision := public.get_game_profile_revision(p_nick_key);

  return v_profile || jsonb_build_object(
    'team', v_team,
    'profileRevision', v_revision,
    'leagueTrophies', jsonb_build_object(
      'total', coalesce(v_league_trophies, 0),
      'history', coalesce(v_league_history, '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.get_game_league_activation(text) from public, anon, authenticated;
revoke all on function public.activate_game_league_if_eligible(uuid) from public, anon, authenticated;
revoke all on function public.create_game_league(text, text, text) from public, anon, authenticated;
revoke all on function public.join_game_league(text, text, text) from public, anon, authenticated;
revoke all on function public.join_game_league(text, text) from public, anon, authenticated, service_role;
revoke all on function public.get_game_league_with_activation(text) from public, anon, authenticated;
revoke all on function public.get_game_player_leagues_with_activation(text) from public, anon, authenticated;
revoke all on function public.start_eligible_game_challenge_pointer_only(text, text, text, text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.sync_game_league_trophies() from public, anon, authenticated;
revoke all on function public.get_game_profile_revision(text) from public, anon, authenticated;
revoke all on function public.get_game_public_profile(text) from public, anon, authenticated;

grant execute on function public.get_game_league_activation(text) to service_role;
grant execute on function public.activate_game_league_if_eligible(uuid) to service_role;
grant execute on function public.create_game_league(text, text, text) to service_role;
grant execute on function public.join_game_league(text, text, text) to service_role;
grant execute on function public.get_game_league_with_activation(text) to service_role;
grant execute on function public.get_game_player_leagues_with_activation(text) to service_role;
grant execute on function public.start_eligible_game_challenge_pointer_only(text, text, text, text, text, uuid, text) to service_role;
grant execute on function public.sync_game_league_trophies() to service_role;
grant execute on function public.get_game_profile_revision(text) to service_role;
grant execute on function public.get_game_public_profile(text) to service_role;
