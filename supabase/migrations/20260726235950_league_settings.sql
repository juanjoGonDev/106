alter table public.game_leagues
  add column if not exists visibility text not null default 'private',
  add column if not exists duration_days smallint not null default 3,
  add column if not exists max_participants smallint not null default 10;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'game_leagues_visibility_check'
      and conrelid = 'public.game_leagues'::regclass
  ) then
    alter table public.game_leagues
      add constraint game_leagues_visibility_check
      check (visibility in ('public', 'private'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'game_leagues_duration_days_check'
      and conrelid = 'public.game_leagues'::regclass
  ) then
    alter table public.game_leagues
      add constraint game_leagues_duration_days_check
      check (duration_days between 1 and 7);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'game_leagues_max_participants_check'
      and conrelid = 'public.game_leagues'::regclass
  ) then
    alter table public.game_leagues
      add constraint game_leagues_max_participants_check
      check (max_participants between 10 and 100 and max_participants % 10 = 0);
  end if;
end;
$$;

create index if not exists game_leagues_directory_idx
  on public.game_leagues(visibility, created_at desc);

create index if not exists game_league_members_identity_idx
  on public.game_league_members(league_id, account_id, device_hash);

create or replace function public.get_game_league_status(p_league_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.get_game_league_activation_state(league.id) || jsonb_build_object(
    'active', league.activated_at is not null
      and league.starts_at <= clock_timestamp()
      and league.ends_at > clock_timestamp(),
    'waiting', league.activated_at is null,
    'scheduled', league.activated_at is not null
      and league.starts_at > clock_timestamp(),
    'finished', league.activated_at is not null
      and league.ends_at <= clock_timestamp(),
    'activatedAt', league.activated_at,
    'scheduledAt', league.activated_at,
    'startsAt', case when league.activated_at is null then null else league.starts_at end,
    'endsAt', case when league.activated_at is null then null else league.ends_at end,
    'countdownSeconds', case
      when league.activated_at is not null and league.starts_at > clock_timestamp()
        then greatest(0, ceil(extract(epoch from league.starts_at - clock_timestamp())))::integer
      else 0
    end,
    'visibility', league.visibility,
    'locked', league.visibility = 'private',
    'durationDays', league.duration_days,
    'maxParticipants', league.max_participants,
    'minParticipants', 3
  )
  from public.game_leagues league
  where league.id = p_league_id;
$$;

create or replace function public.activate_game_league_if_eligible(p_league_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_league public.game_leagues%rowtype;
  v_state jsonb;
  v_now timestamptz := clock_timestamp();
  v_starts_at timestamptz;
begin
  select * into v_league
  from public.game_leagues
  where id = p_league_id
  for update;

  if not found then
    return jsonb_build_object('error', 'league_not_found');
  end if;

  v_state := public.get_game_league_activation_state(v_league.id);

  if v_league.activated_at is null and coalesce((v_state->>'eligible')::boolean, false) then
    v_starts_at := v_now + interval '23 hours';
    update public.game_leagues
    set activated_at = v_now,
        starts_at = v_starts_at,
        ends_at = v_starts_at + make_interval(days => v_league.duration_days)
    where id = v_league.id
    returning * into v_league;
  end if;

  return v_state || jsonb_build_object(
    'active', v_league.activated_at is not null
      and v_league.starts_at <= v_now
      and v_league.ends_at > v_now,
    'waiting', v_league.activated_at is null,
    'scheduled', v_league.activated_at is not null and v_league.starts_at > v_now,
    'finished', v_league.activated_at is not null and v_league.ends_at <= v_now,
    'activatedAt', v_league.activated_at,
    'scheduledAt', v_league.activated_at,
    'startsAt', case when v_league.activated_at is null then null else v_league.starts_at end,
    'endsAt', case when v_league.activated_at is null then null else v_league.ends_at end,
    'countdownSeconds', case
      when v_league.activated_at is not null and v_league.starts_at > v_now
        then greatest(0, ceil(extract(epoch from v_league.starts_at - v_now)))::integer
      else 0
    end,
    'visibility', v_league.visibility,
    'locked', v_league.visibility = 'private',
    'durationDays', v_league.duration_days,
    'maxParticipants', v_league.max_participants,
    'minParticipants', 3
  );
end;
$$;

create or replace function public.create_game_league(
  p_name text,
  p_owner_nick_key text,
  p_device_hash text,
  p_visibility text,
  p_duration_days integer,
  p_max_participants integer
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
  v_visibility text := lower(trim(coalesce(p_visibility, '')));
begin
  if char_length(trim(coalesce(p_name, ''))) not between 3 and 40 then
    return jsonb_build_object('error', 'invalid_league_name');
  end if;

  if v_visibility not in ('public', 'private')
     or p_duration_days is null
     or p_duration_days not between 1 and 7
     or p_max_participants is null
     or p_max_participants not between 10 and 100
     or p_max_participants % 10 <> 0 then
    return jsonb_build_object('error', 'invalid_league_settings');
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
    activated_at,
    visibility,
    duration_days,
    max_participants
  ) values (
    v_public_id,
    v_public_id,
    v_join_code,
    trim(p_name),
    p_owner_nick_key,
    coalesce(v_identity_device_hash, p_device_hash),
    clock_timestamp(),
    clock_timestamp(),
    null,
    v_visibility,
    p_duration_days,
    p_max_participants
  ) returning id into v_id;

  insert into public.game_league_members(league_id, nick_key, account_id, device_hash)
  values (v_id, p_owner_nick_key, v_account_id, v_identity_device_hash)
  on conflict (league_id, nick_key) do nothing;

  return jsonb_build_object(
    'publicId', v_public_id,
    'joinCode', v_join_code,
    'name', trim(p_name),
    'visibility', v_visibility,
    'durationDays', p_duration_days,
    'maxParticipants', p_max_participants
  ) || public.activate_game_league_if_eligible(v_id);
end;
$$;

create or replace function public.create_game_league(
  p_name text,
  p_owner_nick_key text,
  p_device_hash text
) returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select public.create_game_league(
    p_name,
    p_owner_nick_key,
    p_device_hash,
    'private',
    3,
    10
  );
$$;
