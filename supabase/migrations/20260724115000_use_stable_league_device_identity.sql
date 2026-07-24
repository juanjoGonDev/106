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
  v_identity_device_hash text;
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
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
  values (v_id, p_owner_nick_key, v_account_id, v_identity_device_hash)
  on conflict (league_id, nick_key) do nothing;

  return jsonb_build_object('code', v_code, 'name', trim(p_name))
    || public.activate_game_league_if_eligible(v_id);
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
  where code = upper(trim(p_code))
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
  return jsonb_build_object('code', v_league.code, 'name', v_league.name) || v_state;
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

revoke all on function public.create_game_league(text, text, text) from public, anon, authenticated;
revoke all on function public.join_game_league(text, text, text) from public, anon, authenticated;
revoke all on function public.join_game_league(text, text) from public, anon, authenticated;

grant execute on function public.create_game_league(text, text, text) to service_role;
grant execute on function public.join_game_league(text, text, text) to service_role;
grant execute on function public.join_game_league(text, text) to service_role;
