alter table public.game_challenges
  add column if not exists prepared_at timestamptz,
  add column if not exists activated_at timestamptz;

create index if not exists game_challenges_prepared_expiry_idx
  on public.game_challenges(expires_at)
  where prepared_at is not null and activated_at is null and consumed_at is null;

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
    actual.click->>'trusted' = 'true'
    and actual.click->>'pointerType' in ('mouse', 'touch', 'pen')
    and power((actual.click->>'x')::numeric - (expected.ball->>'x')::numeric, 2)
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
  v_result jsonb;
  v_challenge_id uuid;
  v_prepared_at timestamptz := clock_timestamp();
  v_ready_expires_at timestamptz := v_prepared_at + interval '2 minutes';
begin
  v_result := public.start_game_challenge_pointer_only(
    p_nick,
    p_nick_key,
    p_team,
    p_device_hash,
    p_ip_hash,
    p_referral_code,
    p_league_code
  );

  if v_result ? 'error' then return v_result; end if;

  v_challenge_id := (v_result->>'challengeId')::uuid;
  update public.game_challenges
  set prepared_at = v_prepared_at,
      activated_at = null,
      expires_at = v_ready_expires_at
  where id = v_challenge_id;

  return v_result || jsonb_build_object(
    'prepared', true,
    'readyExpiresAt', v_ready_expires_at
  );
end;
$$;

create or replace function public.activate_game_challenge_pointer_only(
  p_challenge_id uuid,
  p_device_hash text,
  p_ip_hash text,
  p_countdown_ms integer
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_challenge public.game_challenges%rowtype;
  v_activated_at timestamptz := clock_timestamp();
  v_starts_at timestamptz;
begin
  if p_countdown_ms <> 3000 then
    return jsonb_build_object('error', 'invalid_countdown');
  end if;

  select * into v_challenge
  from public.game_challenges
  where id = p_challenge_id
  for update;

  if not found then return jsonb_build_object('error', 'challenge_not_found'); end if;
  if v_challenge.consumed_at is not null then return jsonb_build_object('error', 'challenge_used'); end if;
  if v_challenge.prepared_at is null then return jsonb_build_object('error', 'challenge_not_prepared'); end if;
  if v_challenge.activated_at is not null then return jsonb_build_object('error', 'challenge_already_activated'); end if;
  if v_challenge.expires_at <= v_activated_at then return jsonb_build_object('error', 'challenge_expired'); end if;
  if v_challenge.device_hash <> p_device_hash or v_challenge.ip_hash <> p_ip_hash then
    return jsonb_build_object('error', 'device_mismatch');
  end if;

  v_starts_at := v_activated_at + p_countdown_ms * interval '1 millisecond';
  update public.game_challenges
  set activated_at = v_activated_at,
      started_at = v_starts_at,
      expires_at = v_starts_at + interval '30 seconds'
  where id = p_challenge_id;

  return jsonb_build_object(
    'ok', true,
    'activatedAt', v_activated_at,
    'startsAt', v_starts_at,
    'expiresAt', v_starts_at + interval '30 seconds'
  );
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
  v_pointer_type text := left(coalesce(p_client_signals->>'pointerType', ''), 16);
  v_normalized_signals jsonb := coalesce(p_client_signals, '{}'::jsonb);
begin
  select * into v_challenge
  from public.game_challenges
  where id = p_challenge_id
  for update;

  if not found then return jsonb_build_object('error', 'challenge_not_found'); end if;
  if v_challenge.prepared_at is not null and v_challenge.activated_at is null then
    return jsonb_build_object('error', 'challenge_not_activated');
  end if;

  if v_challenge.interaction_mode <> 'press'
     or coalesce(p_client_signals->>'interactionMode', '') <> 'press'
     or coalesce(p_client_signals->>'finishEvent', '') <> 'pointerdown'
     or v_pointer_type not in ('mouse', 'touch', 'pen')
     or coalesce(p_client_signals->>'pointerTrusted', 'false') <> 'true'
     or coalesce(p_client_signals->>'keyboardKey', '') <> '' then
    return jsonb_build_object('error', 'invalid_pointer_finish');
  end if;

  if v_pointer_type = 'mouse'
     and coalesce(p_client_signals->>'userActivation', 'false') <> 'true' then
    return jsonb_build_object('error', 'invalid_pointer_finish');
  end if;

  if v_pointer_type in ('touch', 'pen')
     and coalesce(p_client_signals->>'automationDetected', 'false') = 'true' then
    return jsonb_build_object('error', 'invalid_pointer_finish');
  end if;

  v_normalized_signals := jsonb_set(
    v_normalized_signals,
    '{userActivationObserved}',
    case
      when coalesce(p_client_signals->>'userActivation', 'false') = 'true' then 'true'::jsonb
      else 'false'::jsonb
    end,
    true
  );

  if v_pointer_type in ('touch', 'pen') then
    v_normalized_signals := jsonb_set(
      v_normalized_signals,
      '{userActivation}',
      'true'::jsonb,
      true
    );
  end if;

  return public.finish_game_attempt(
    p_challenge_id,
    p_client_elapsed_ms,
    p_device_hash,
    p_ip_hash,
    v_normalized_signals
  );
end;
$$;

revoke all on function public.complete_game_human_check(uuid, text, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.prepare_game_challenge_pointer_only(text, text, text, text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.activate_game_challenge_pointer_only(uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.finish_game_attempt_pointer_only(uuid, integer, text, text, jsonb) from public, anon, authenticated;

grant execute on function public.complete_game_human_check(uuid, text, text, jsonb, text) to service_role;
grant execute on function public.prepare_game_challenge_pointer_only(text, text, text, text, text, uuid, text) to service_role;
grant execute on function public.activate_game_challenge_pointer_only(uuid, text, text, integer) to service_role;
grant execute on function public.finish_game_attempt_pointer_only(uuid, integer, text, text, jsonb) to service_role;
