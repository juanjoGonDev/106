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
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  if char_length(trim(p_name)) not between 3 and 40 then
    return jsonb_build_object('error', 'invalid_league_name');
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
    )
    into v_code
    from generate_series(0, 5) as byte_index;

    exit when not exists (
      select 1
      from public.game_leagues
      where code = v_code
    );
  end loop;

  insert into public.game_leagues (
    code,
    name,
    owner_nick_key,
    owner_device_hash
  ) values (
    v_code,
    trim(p_name),
    p_owner_nick_key,
    p_device_hash
  )
  returning id into v_id;

  insert into public.game_league_members (league_id, nick_key)
  values (v_id, p_owner_nick_key)
  on conflict do nothing;

  return jsonb_build_object(
    'code', v_code,
    'name', trim(p_name),
    'endsAt', clock_timestamp() + interval '3 days'
  );
end;
$$;

revoke all on function public.create_game_league(text, text, text)
from public, anon, authenticated;

grant execute on function public.create_game_league(text, text, text)
to service_role;
