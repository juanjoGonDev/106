create table if not exists public.game_turnstile_tokens (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  consumed_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null
);

create index if not exists game_turnstile_tokens_expiry_idx
  on public.game_turnstile_tokens(expires_at);

alter table public.game_turnstile_tokens enable row level security;
revoke all on table public.game_turnstile_tokens from public, anon, authenticated;

create or replace function public.consume_game_turnstile_token(
  p_token_hash text,
  p_expires_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
begin
  if coalesce(p_token_hash, '') !~ '^[a-f0-9]{64}$'
     or p_expires_at is null
     or p_expires_at <= v_now
     or p_expires_at > v_now + interval '10 minutes' then
    return jsonb_build_object('error', 'turnstile_invalid');
  end if;

  delete from public.game_turnstile_tokens
  where expires_at < v_now - interval '1 day';

  insert into public.game_turnstile_tokens(token_hash, consumed_at, expires_at)
  values (p_token_hash, v_now, p_expires_at)
  on conflict (token_hash) do nothing;

  if not found then
    return jsonb_build_object('error', 'turnstile_replay');
  end if;

  return jsonb_build_object('ok', true, 'expiresAt', p_expires_at);
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

  return jsonb_build_object('checkId', v_check.id, 'balls', v_check.balls);
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
declare
  v_check public.game_human_checks%rowtype;
  v_valid boolean := false;
  v_ready_expires_at timestamptz := clock_timestamp() + interval '2 minutes';
begin
  select * into v_check
  from public.game_human_checks
  where id = p_check_id
  for update;

  if not found then return jsonb_build_object('error', 'human_check_not_found'); end if;
  if v_check.consumed_at is not null then return jsonb_build_object('error', 'human_check_used'); end if;
  if v_check.completed_at is not null then return jsonb_build_object('error', 'human_check_completed'); end if;
  if v_check.expires_at <= clock_timestamp() then return jsonb_build_object('error', 'human_check_expired'); end if;
  if v_check.device_hash <> p_device_hash or v_check.ip_hash <> p_ip_hash then
    return jsonb_build_object('error', 'human_check_mismatch');
  end if;
  if jsonb_typeof(p_clicks) <> 'array'
     or jsonb_array_length(p_clicks) <> jsonb_array_length(v_check.balls)
     or coalesce(p_proof_token_hash, '') !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('error', 'human_check_invalid');
  end if;

  select coalesce(bool_and(
    power((actual.click->>'x')::numeric - (expected.ball->>'x')::numeric, 2)
      + power((actual.click->>'y')::numeric - (expected.ball->>'y')::numeric, 2)
      <= power((expected.ball->>'radius')::numeric, 2)
  ), false)
  into v_valid
  from jsonb_array_elements(v_check.balls) with ordinality as expected(ball, position)
  join jsonb_array_elements(p_clicks) with ordinality as actual(click, position)
    using (position);

  if not v_valid then return jsonb_build_object('error', 'human_check_failed'); end if;

  update public.game_human_checks
  set completed_clicks = p_clicks,
      proof_token_hash = p_proof_token_hash,
      completed_at = clock_timestamp(),
      expires_at = v_ready_expires_at
  where id = p_check_id;

  return jsonb_build_object('ok', true, 'expiresAt', v_ready_expires_at);
end;
$$;

create or replace function public.finish_game_attempt_pointer_only(
  p_challenge_id uuid,
  p_client_elapsed_ms integer,
  p_device_hash text,
  p_ip_hash text,
  p_client_signals jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_challenge public.game_challenges%rowtype;
  v_now timestamptz := clock_timestamp();
  v_server_elapsed_ms integer;
  v_transport_delta_ms integer;
  v_is_timeout boolean := p_client_elapsed_ms = 30000
    and coalesce(p_client_signals->>'automaticFinish', 'false') = 'true';
  v_pointer_type text := case
    when coalesce(p_client_signals->>'pointerType', '') in ('mouse', 'touch', 'pen')
      then p_client_signals->>'pointerType'
    else 'unknown'
  end;
  v_authoritative_signals jsonb;
  v_result jsonb;
begin
  select * into v_challenge
  from public.game_challenges
  where id = p_challenge_id
  for update;

  if not found then return jsonb_build_object('error', 'challenge_not_found'); end if;
  if v_challenge.consumed_at is not null then return jsonb_build_object('error', 'challenge_used'); end if;
  if v_challenge.prepared_at is not null and v_challenge.activated_at is null then
    return jsonb_build_object('error', 'challenge_not_activated');
  end if;
  if v_challenge.device_hash <> p_device_hash then return jsonb_build_object('error', 'device_mismatch'); end if;
  if v_challenge.started_at is null then return jsonb_build_object('error', 'challenge_not_activated'); end if;
  if p_client_elapsed_ms is null or p_client_elapsed_ms not between 2000 and 30000 then
    update public.game_challenges set consumed_at = v_now where id = p_challenge_id;
    return jsonb_build_object('error', 'invalid_timing');
  end if;

  v_server_elapsed_ms := round(extract(epoch from (v_now - v_challenge.started_at)) * 1000)::integer;
  v_transport_delta_ms := v_server_elapsed_ms - p_client_elapsed_ms;

  if v_is_timeout then
    if v_server_elapsed_ms not between 29250 and 33000 then
      update public.game_challenges set consumed_at = v_now where id = p_challenge_id;
      return jsonb_build_object(
        'error', 'timing_mismatch',
        'serverElapsedMs', v_server_elapsed_ms,
        'transportDeltaMs', v_transport_delta_ms
      );
    end if;
  elsif v_transport_delta_ms not between -750 and 2500 then
    update public.game_challenges set consumed_at = v_now where id = p_challenge_id;
    return jsonb_build_object(
      'error', 'timing_mismatch',
      'serverElapsedMs', v_server_elapsed_ms,
      'transportDeltaMs', v_transport_delta_ms
    );
  end if;

  v_authoritative_signals := jsonb_build_object(
    'trustedStart', true,
    'trustedFinish', true,
    'timerConcealed', true,
    'visibilityChanges', 0,
    'focusLosses', 0,
    'interactionMode', v_challenge.interaction_mode,
    'controlNonce', v_challenge.interaction_nonce::text,
    'finishEvent', case when v_is_timeout then '' else 'pointerdown' end,
    'pointerTrusted', true,
    'userActivation', true,
    'automationDetected', false,
    'pointerType', case when v_is_timeout then 'unknown' else v_pointer_type end,
    'pointerXPercent', v_challenge.target_x_percent,
    'pointerYPercent', v_challenge.target_y_percent,
    'pointerMoveCount', case when v_is_timeout then 0 else 1 end,
    'pointerTravelPx', case when v_is_timeout then 0 else 1 end,
    'pointerDwellMs', 0,
    'pressureMax', 0,
    'holdDurationMs', 0,
    'samePointer', true,
    'automaticFinish', v_is_timeout,
    'clientTelemetry', coalesce(p_client_signals, '{}'::jsonb)
  );

  v_result := public.finish_game_attempt(
    p_challenge_id,
    p_client_elapsed_ms,
    p_device_hash,
    p_ip_hash,
    v_authoritative_signals
  );

  if v_result ? 'error' then return v_result; end if;

  v_result := jsonb_set(v_result, '{attempt,serverElapsedMs}', to_jsonb(v_server_elapsed_ms), true);
  v_result := jsonb_set(v_result, '{attempt,transportDeltaMs}', to_jsonb(v_transport_delta_ms), true);
  return v_result;
end;
$$;

revoke all on function public.consume_game_turnstile_token(text, timestamptz) from public, anon, authenticated;
revoke all on function public.get_game_human_check_solution_for_test(uuid, text) from public, anon, authenticated;
revoke all on function public.complete_game_human_check(uuid, text, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.finish_game_attempt_pointer_only(uuid, integer, text, text, jsonb) from public, anon, authenticated;

grant execute on function public.consume_game_turnstile_token(text, timestamptz) to service_role;
grant execute on function public.get_game_human_check_solution_for_test(uuid, text) to service_role;
grant execute on function public.complete_game_human_check(uuid, text, text, jsonb, text) to service_role;
grant execute on function public.finish_game_attempt_pointer_only(uuid, integer, text, text, jsonb) to service_role;
