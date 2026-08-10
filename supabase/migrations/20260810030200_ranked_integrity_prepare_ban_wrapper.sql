do $$
begin
  if to_regprocedure('public.prepare_game_challenge_pointer_only_unchecked(text,text,text,text,text,uuid,text)') is null then
    alter function public.prepare_game_challenge_pointer_only(text, text, text, text, text, uuid, text)
      rename to prepare_game_challenge_pointer_only_unchecked;
  end if;
end;
$$;

create or replace function public.prepare_game_challenge_pointer_only(
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
  v_ban jsonb;
begin
  v_ban := public.get_game_active_integrity_ban(
    p_nick_key,
    p_device_hash,
    p_ip_hash,
    clock_timestamp()
  );
  if coalesce((v_ban->>'banned')::boolean, false) then
    return jsonb_build_object('error', 'integrity_banned') || (v_ban - 'banned');
  end if;

  return public.prepare_game_challenge_pointer_only_unchecked(
    p_nick,
    p_nick_key,
    p_team,
    p_device_hash,
    p_ip_hash,
    p_referral_code,
    p_league_code
  );
end;
$$;

revoke all on function public.prepare_game_challenge_pointer_only_unchecked(text, text, text, text, text, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.prepare_game_challenge_pointer_only(text, text, text, text, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.prepare_game_challenge_pointer_only(text, text, text, text, text, uuid, text)
  to service_role;

comment on function public.prepare_game_challenge_pointer_only(text, text, text, text, text, uuid, text) is
  'Policy-v3 prepared-start wrapper. Active integrity restrictions fail before challenge creation; the renamed implementation is not API-executable.';
