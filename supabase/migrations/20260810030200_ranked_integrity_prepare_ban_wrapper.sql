do $$
begin
  if to_regprocedure('public.prepare_game_challenge_pointer_only_unchecked(text,text,text,text,text,uuid,text)') is null then
    alter function public.prepare_game_challenge_pointer_only(text, text, text, text, text, uuid, text)
      rename to prepare_game_challenge_pointer_only_unchecked;
  end if;
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

  return public.start_game_challenge_pointer_only_policy_v2(
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
  v_result jsonb;
  v_attempt_id uuid;
  v_effective_verified boolean;
  v_integrity_result jsonb;
begin
  v_result := public.finish_game_attempt_pointer_only_policy_v2(
    p_challenge_id,
    p_client_elapsed_ms,
    p_device_hash,
    p_ip_hash,
    p_client_signals
  );
  if v_result ? 'error' then return v_result; end if;

  v_attempt_id := nullif(v_result #>> '{attempt,id}', '')::uuid;
  if v_attempt_id is null then return v_result; end if;

  v_integrity_result := public.reassess_game_integrity_cluster(v_attempt_id);
  select attempt.verified into v_effective_verified
  from public.game_attempts attempt
  where attempt.id = v_attempt_id;

  v_result := jsonb_set(
    v_result,
    '{attempt,verified}',
    to_jsonb(coalesce(v_effective_verified, false)),
    true
  );

  if coalesce((v_integrity_result->>'malicious')::boolean, false) then
    v_result := jsonb_set(
      v_result,
      '{attempt,restrictedUntil}',
      to_jsonb(v_integrity_result->>'restrictedUntil'),
      true
    );
  end if;

  return v_result;
end;
$$;

revoke all on function public.start_game_challenge_pointer_only_policy_v2(text, text, text, text, text, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.finish_game_attempt_pointer_only_policy_v2(uuid, integer, text, text, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.prepare_game_challenge_pointer_only_unchecked(text, text, text, text, text, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.start_game_challenge_pointer_only(text, text, text, text, text, uuid, text)
  from public, anon, authenticated;
revoke all on function public.prepare_game_challenge_pointer_only(text, text, text, text, text, uuid, text)
  from public, anon, authenticated;
revoke all on function public.finish_game_attempt_pointer_only(uuid, integer, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.start_game_challenge_pointer_only(text, text, text, text, text, uuid, text)
  to service_role;
grant execute on function public.prepare_game_challenge_pointer_only(text, text, text, text, text, uuid, text)
  to service_role;
grant execute on function public.finish_game_attempt_pointer_only(uuid, integer, text, text, jsonb)
  to service_role;

comment on function public.start_game_challenge_pointer_only(text, text, text, text, text, uuid, text) is
  'Policy-v3 ranked-start wrapper. Active integrity restrictions fail before challenge creation while the preserved implementation remains the owner of league gates and quota reservations.';
comment on function public.prepare_game_challenge_pointer_only(text, text, text, text, text, uuid, text) is
  'Policy-v3 prepared-start wrapper. Active integrity restrictions fail before challenge creation; the preserved implementation remains the owner of preparation semantics.';
comment on function public.finish_game_attempt_pointer_only(uuid, integer, text, text, jsonb) is
  'Policy-v3 ranked-finish wrapper. The preserved implementation remains authoritative for timing and one-use semantics; integrity reassessment only updates derived eligibility after a persisted attempt.';
