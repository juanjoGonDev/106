alter table public.game_human_checks
  add column if not exists selected_count smallint not null default 0,
  add column if not exists state_version integer not null default 0;

update public.game_human_checks
set selected_count = 4,
    state_version = greatest(state_version, 4)
where completed_at is not null
  and selected_count <> 4;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.game_human_checks'::regclass
      and conname = 'game_human_checks_selected_count_check'
  ) then
    alter table public.game_human_checks
      add constraint game_human_checks_selected_count_check
      check (selected_count between 0 and 4);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.game_human_checks'::regclass
      and conname = 'game_human_checks_state_version_check'
  ) then
    alter table public.game_human_checks
      add constraint game_human_checks_state_version_check
      check (state_version >= 0);
  end if;
end;
$$;

create or replace function public.get_game_human_check_solution_for_test(
  p_check_id uuid,
  p_device_hash text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_check public.game_human_checks%rowtype;
begin
  select * into v_check
  from public.game_human_checks
  where id = p_check_id;

  if not found then return jsonb_build_object('error', 'human_check_not_found'); end if;
  if v_check.device_hash <> p_device_hash then return jsonb_build_object('error', 'human_check_mismatch'); end if;
  if v_check.expires_at <= clock_timestamp() then return jsonb_build_object('error', 'human_check_expired'); end if;

  return jsonb_build_object(
    'checkId', v_check.id,
    'balls', v_check.balls,
    'selectedCount', v_check.selected_count,
    'stateVersion', v_check.state_version
  );
end;
$$;

create or replace function public.advance_game_human_check_raster(
  p_check_id uuid,
  p_device_hash text,
  p_ip_hash text,
  p_click jsonb,
  p_expected_version integer,
  p_proof_token_hash text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_check public.game_human_checks%rowtype;
  v_expected_ball jsonb;
  v_clicks jsonb;
  v_x numeric;
  v_y numeric;
  v_at_ms integer;
  v_previous_at_ms integer := 0;
  v_next_count integer;
  v_next_version integer;
  v_completed boolean;
  v_now timestamptz := clock_timestamp();
  v_expires_at timestamptz;
begin
  select * into v_check
  from public.game_human_checks
  where id = p_check_id
  for update;

  if not found then return jsonb_build_object('error', 'human_check_not_found'); end if;
  if v_check.consumed_at is not null then return jsonb_build_object('error', 'human_check_used'); end if;
  if v_check.completed_at is not null then return jsonb_build_object('error', 'human_check_completed'); end if;
  if v_check.expires_at <= v_now then return jsonb_build_object('error', 'human_check_expired'); end if;
  if v_check.device_hash <> p_device_hash or v_check.ip_hash <> p_ip_hash then
    return jsonb_build_object('error', 'human_check_mismatch');
  end if;
  if p_expected_version is null or p_expected_version <> v_check.state_version then
    return jsonb_build_object(
      'error', 'human_check_stale',
      'selectedCount', v_check.selected_count,
      'stateVersion', v_check.state_version
    );
  end if;
  if v_check.selected_count not between 0 and 3
     or jsonb_typeof(v_check.balls) <> 'array'
     or jsonb_array_length(v_check.balls) <> 4
     or jsonb_typeof(p_click) <> 'object' then
    return jsonb_build_object('error', 'human_check_invalid');
  end if;

  begin
    v_x := (p_click->>'x')::numeric;
    v_y := (p_click->>'y')::numeric;
    v_at_ms := (p_click->>'atMs')::integer;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      return jsonb_build_object('error', 'human_check_invalid');
  end;

  if v_x not between 0 and 100
     or v_y not between 0 and 100
     or v_at_ms not between 1 and 20000
     or coalesce(p_click->>'pointerType', '') not in ('mouse', 'touch', 'pen') then
    return jsonb_build_object('error', 'human_check_invalid');
  end if;

  if jsonb_typeof(v_check.completed_clicks) = 'array'
     and jsonb_array_length(v_check.completed_clicks) > 0 then
    v_previous_at_ms := coalesce(
      (v_check.completed_clicks -> (jsonb_array_length(v_check.completed_clicks) - 1) ->> 'atMs')::integer,
      0
    );
  end if;
  if v_at_ms <= v_previous_at_ms then
    return jsonb_build_object('error', 'human_check_invalid');
  end if;

  v_expected_ball := v_check.balls -> v_check.selected_count;
  if v_expected_ball is null then
    return jsonb_build_object('error', 'human_check_invalid');
  end if;

  if power(v_x - (v_expected_ball->>'x')::numeric, 2)
       + power(v_y - (v_expected_ball->>'y')::numeric, 2)
       > power((v_expected_ball->>'radius')::numeric, 2) then
    update public.game_human_checks
    set consumed_at = v_now,
        state_version = state_version + 1
    where id = p_check_id;
    return jsonb_build_object('error', 'human_check_failed');
  end if;

  v_clicks := coalesce(v_check.completed_clicks, '[]'::jsonb) || jsonb_build_array(p_click);
  v_next_count := v_check.selected_count + 1;
  v_next_version := v_check.state_version + 1;
  v_completed := v_next_count = 4;
  v_expires_at := case
    when v_completed then v_now + interval '2 minutes'
    else v_check.expires_at
  end;

  if v_completed and coalesce(p_proof_token_hash, '') !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('error', 'human_check_invalid');
  end if;

  update public.game_human_checks
  set selected_count = v_next_count,
      state_version = v_next_version,
      completed_clicks = v_clicks,
      proof_token_hash = case when v_completed then p_proof_token_hash else proof_token_hash end,
      completed_at = case when v_completed then v_now else completed_at end,
      expires_at = v_expires_at
  where id = p_check_id;

  return jsonb_build_object(
    'ok', true,
    'checkId', p_check_id,
    'selectedCount', v_next_count,
    'stateVersion', v_next_version,
    'completed', v_completed,
    'expiresAt', v_expires_at,
    'balls', v_check.balls
  );
end;
$$;

revoke all on function public.get_game_human_check_solution_for_test(uuid, text) from public, anon, authenticated;
revoke all on function public.advance_game_human_check_raster(uuid, text, text, jsonb, integer, text) from public, anon, authenticated;

grant execute on function public.get_game_human_check_solution_for_test(uuid, text) to service_role;
grant execute on function public.advance_game_human_check_raster(uuid, text, text, jsonb, integer, text) to service_role;
