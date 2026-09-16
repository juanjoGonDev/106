do $$
begin
  if to_regprocedure('public.create_game_human_check_storage(text,text,jsonb)') is null then
    alter function public.create_game_human_check(text, text, jsonb)
      rename to create_game_human_check_storage;
  end if;
end;
$$;

create or replace function public.create_game_human_check_raster(
  p_device_hash text,
  p_ip_hash text,
  p_balls jsonb
) returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select public.create_game_human_check_storage(p_device_hash, p_ip_hash, p_balls);
$$;

create or replace function public.create_game_human_check(
  p_device_hash text,
  p_ip_hash text,
  p_balls jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception using
    errcode = 'P0001',
    message = 'legacy human-check contract disabled';
end;
$$;

do $$
begin
  if to_regprocedure('public.complete_game_human_check_raster(uuid,text,text,jsonb,text)') is null then
    alter function public.complete_game_human_check(uuid, text, text, jsonb, text)
      rename to complete_game_human_check_raster;
  end if;
end;
$$;

create or replace function public.complete_game_human_check(
  p_check_id uuid,
  p_device_hash text,
  p_ip_hash text,
  p_clicks jsonb,
  p_proof_token_hash text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception using
    errcode = 'P0001',
    message = 'legacy human-check contract disabled';
end;
$$;

revoke all on function public.create_game_human_check_storage(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.create_game_human_check_raster(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.create_game_human_check(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.complete_game_human_check_raster(uuid, text, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.complete_game_human_check(uuid, text, text, jsonb, text) from public, anon, authenticated;

grant execute on function public.create_game_human_check_raster(text, text, jsonb) to service_role;
grant execute on function public.complete_game_human_check_raster(uuid, text, text, jsonb, text) to service_role;
