create or replace function public.join_game_league(
  p_code text,
  p_public_id text,
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
  v_member_count integer;
  v_state jsonb;
  v_private_code text := nullif(upper(trim(coalesce(p_code, ''))), '');
  v_public_id text := nullif(upper(trim(coalesce(p_public_id, ''))), '');
begin
  if (v_private_code is null) = (v_public_id is null) then
    return jsonb_build_object('error', 'invalid_input');
  end if;

  select * into v_league
  from public.game_leagues league
  where (v_private_code is not null and league.join_code = v_private_code)
     or (v_public_id is not null
       and league.public_id = v_public_id
       and league.visibility = 'public')
  order by (v_private_code is not null and league.join_code = v_private_code) desc
  limit 1
  for update;

  if not found then
    return jsonb_build_object('error', 'league_not_found');
  end if;

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

  if exists (
    select 1
    from public.game_league_members member
    where member.league_id = v_league.id
      and member.nick_key = p_nick_key
  ) then
    return jsonb_build_object(
      'publicId', v_league.public_id,
      'name', v_league.name,
      'alreadyMember', true
    ) || public.get_game_league_status(v_league.id);
  end if;

  if exists (
    select 1
    from public.game_league_members member
    where member.league_id = v_league.id
      and (member.account_id = v_account_id or member.device_hash = v_identity_device_hash)
  ) then
    return jsonb_build_object('error', 'league_identity_limit');
  end if;

  select count(*)::integer into v_member_count
  from public.game_league_members member
  where member.league_id = v_league.id;

  if v_member_count >= v_league.max_participants then
    return jsonb_build_object('error', 'league_full');
  end if;

  insert into public.game_league_members(league_id, nick_key, account_id, device_hash)
  values (v_league.id, p_nick_key, v_account_id, v_identity_device_hash);

  v_state := public.activate_game_league_if_eligible(v_league.id);
  return jsonb_build_object(
    'publicId', v_league.public_id,
    'name', v_league.name
  ) || v_state;
end;
$$;

create or replace function public.join_game_league(
  p_code text,
  p_nick_key text,
  p_device_hash text
) returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select public.join_game_league(p_code, null, p_nick_key, p_device_hash);
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

  return public.join_game_league(p_code, null, p_nick_key, v_identity_device_hash);
end;
$$;
