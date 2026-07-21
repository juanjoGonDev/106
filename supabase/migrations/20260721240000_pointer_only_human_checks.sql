create table if not exists public.game_human_checks (
  id uuid primary key default gen_random_uuid(),
  device_hash text not null,
  ip_hash text not null,
  balls jsonb not null,
  completed_clicks jsonb,
  proof_token_hash text,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default clock_timestamp() + interval '90 seconds',
  completed_at timestamptz,
  consumed_at timestamptz,
  constraint game_human_checks_ball_count_check
    check (jsonb_typeof(balls) = 'array' and jsonb_array_length(balls) = 4),
  constraint game_human_checks_expiry_check check (expires_at > created_at)
);

create index if not exists game_human_checks_device_created_idx
  on public.game_human_checks(device_hash, created_at desc);
create index if not exists game_human_checks_ip_created_idx
  on public.game_human_checks(ip_hash, created_at desc);

alter table public.game_human_checks enable row level security;
revoke all on table public.game_human_checks from anon, authenticated;

create or replace function public.create_game_human_check(
  p_device_hash text,
  p_ip_hash text,
  p_balls jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_expires_at timestamptz := clock_timestamp() + interval '90 seconds';
begin
  if char_length(coalesce(p_device_hash, '')) < 32
     or char_length(coalesce(p_ip_hash, '')) < 32
     or jsonb_typeof(p_balls) <> 'array'
     or jsonb_array_length(p_balls) <> 4 then
    return jsonb_build_object('error', 'human_check_invalid');
  end if;

  if (select count(*) from public.game_human_checks
      where device_hash = p_device_hash
        and created_at > clock_timestamp() - interval '1 minute') >= 12 then
    return jsonb_build_object('error', 'human_check_rate_limit');
  end if;

  if (select count(*) from public.game_human_checks
      where ip_hash = p_ip_hash
        and created_at > clock_timestamp() - interval '1 minute') >= 60 then
    return jsonb_build_object('error', 'human_check_rate_limit');
  end if;

  insert into public.game_human_checks(device_hash, ip_hash, balls, expires_at)
  values (p_device_hash, p_ip_hash, p_balls, v_expires_at)
  returning id into v_id;

  return jsonb_build_object(
    'checkId', v_id,
    'expiresAt', v_expires_at
  );
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
      completed_at = clock_timestamp()
  where id = p_check_id;

  return jsonb_build_object('ok', true, 'expiresAt', v_check.expires_at);
end;
$$;

create or replace function public.consume_game_human_check(
  p_check_id uuid,
  p_device_hash text,
  p_ip_hash text,
  p_proof_token_hash text
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
  where id = p_check_id
  for update;

  if not found then return jsonb_build_object('error', 'human_check_not_found'); end if;
  if v_check.completed_at is null then return jsonb_build_object('error', 'human_check_incomplete'); end if;
  if v_check.consumed_at is not null then return jsonb_build_object('error', 'human_check_used'); end if;
  if v_check.expires_at <= clock_timestamp() then return jsonb_build_object('error', 'human_check_expired'); end if;
  if v_check.device_hash <> p_device_hash
     or v_check.ip_hash <> p_ip_hash
     or v_check.proof_token_hash <> p_proof_token_hash then
    return jsonb_build_object('error', 'human_check_mismatch');
  end if;

  update public.game_human_checks
  set consumed_at = clock_timestamp()
  where id = p_check_id;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.start_game_challenge_pointer_only(
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
begin
  v_result := public.start_game_challenge(
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
  set interaction_mode = 'press',
      min_hold_ms = 0,
      max_hold_ms = 0
  where id = v_challenge_id;

  v_result := jsonb_set(v_result, '{interaction,mode}', to_jsonb('press'::text), true);
  v_result := v_result #- '{interaction,keyboardKey}' #- '{interaction,minHoldMs}' #- '{interaction,maxHoldMs}';
  return v_result;
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
begin
  select * into v_challenge
  from public.game_challenges
  where id = p_challenge_id
  for update;

  if not found then return jsonb_build_object('error', 'challenge_not_found'); end if;
  if v_challenge.interaction_mode <> 'press'
     or coalesce(p_client_signals->>'interactionMode', '') <> 'press'
     or coalesce(p_client_signals->>'finishEvent', '') <> 'pointerdown'
     or coalesce(p_client_signals->>'pointerType', '') not in ('mouse', 'touch', 'pen')
     or coalesce(p_client_signals->>'pointerTrusted', 'false') <> 'true'
     or coalesce(p_client_signals->>'userActivation', 'false') <> 'true'
     or coalesce(p_client_signals->>'keyboardKey', '') <> '' then
    return jsonb_build_object('error', 'invalid_pointer_finish');
  end if;

  return public.finish_game_attempt(
    p_challenge_id,
    p_client_elapsed_ms,
    p_device_hash,
    p_ip_hash,
    p_client_signals
  );
end;
$$;

revoke all on function public.create_game_human_check(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.complete_game_human_check(uuid, text, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.consume_game_human_check(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.start_game_challenge_pointer_only(text, text, text, text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.finish_game_attempt_pointer_only(uuid, integer, text, text, jsonb) from public, anon, authenticated;

grant execute on function public.create_game_human_check(text, text, jsonb) to service_role;
grant execute on function public.complete_game_human_check(uuid, text, text, jsonb, text) to service_role;
grant execute on function public.consume_game_human_check(uuid, text, text, text) to service_role;
grant execute on function public.start_game_challenge_pointer_only(text, text, text, text, text, uuid, text) to service_role;
grant execute on function public.finish_game_attempt_pointer_only(uuid, integer, text, text, jsonb) to service_role;
