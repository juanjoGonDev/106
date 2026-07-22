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

  if v_challenge.interaction_mode <> 'press'
     or coalesce(p_client_signals->>'interactionMode', '') <> 'press'
     or coalesce(p_client_signals->>'finishEvent', '') <> 'pointerdown'
     or v_pointer_type not in ('mouse', 'touch', 'pen')
     or coalesce(p_client_signals->>'pointerTrusted', 'false') <> 'true'
     or coalesce(p_client_signals->>'keyboardKey', '') <> '' then
    return jsonb_build_object('error', 'invalid_pointer_finish');
  end if;

  -- The User Activation API is reliable on desktop mouse input but may be
  -- absent or report false in mobile browsers and in-app webviews even for a
  -- trusted PointerEvent. Touch and pen input remain protected by the
  -- server-issued visual proof, one-time nonce, device/IP binding and timing
  -- validation. Browser automation detected by the client is never accepted
  -- through this compatibility path.
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
    -- `finish_game_attempt` predates mobile compatibility and treats browser
    -- activation as a ranking signal. Normalize it only after the stricter
    -- pointer-only wrapper has validated the trusted mobile path, while
    -- retaining the observed value above for audit telemetry.
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

revoke all on function public.finish_game_attempt_pointer_only(uuid, integer, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.finish_game_attempt_pointer_only(uuid, integer, text, text, jsonb)
  to service_role;
