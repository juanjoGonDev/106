create or replace function public.zadmin_login_gate(
  p_ip_hash text,
  p_device_hash text,
  p_credentials_valid boolean,
  p_at timestamptz default clock_timestamp()
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := coalesce(p_at, clock_timestamp());
  v_window_start timestamptz := v_now - interval '1 hour';
  v_ip_count integer := 0;
  v_device_count integer := 0;
  v_ip_oldest timestamptz;
  v_device_oldest timestamptz;
  v_retry_at timestamptz;
  v_lock_ip bigint;
  v_lock_device bigint;
begin
  if coalesce(p_ip_hash, '') !~ '^[a-f0-9]{64}$'
     or coalesce(p_device_hash, '') !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('error', 'invalid_subject');
  end if;

  v_lock_ip := hashtextextended('zadmin:ip:' || p_ip_hash, 0);
  v_lock_device := hashtextextended('zadmin:device:' || p_device_hash, 0);
  perform pg_advisory_xact_lock(least(v_lock_ip, v_lock_device));
  if v_lock_ip <> v_lock_device then
    perform pg_advisory_xact_lock(greatest(v_lock_ip, v_lock_device));
  end if;

  select count(*)::integer, min(attempted_at)
    into v_ip_count, v_ip_oldest
  from public.game_admin_login_failures
  where ip_hash = p_ip_hash
    and attempted_at > v_window_start;

  select count(*)::integer, min(attempted_at)
    into v_device_count, v_device_oldest
  from public.game_admin_login_failures
  where device_hash = p_device_hash
    and attempted_at > v_window_start;

  if v_ip_count >= 3 or v_device_count >= 3 then
    v_retry_at := least(
      case when v_ip_count >= 3 then v_ip_oldest + interval '1 hour' else 'infinity'::timestamptz end,
      case when v_device_count >= 3 then v_device_oldest + interval '1 hour' else 'infinity'::timestamptz end
    );
    return jsonb_build_object(
      'allowed', false,
      'authenticated', false,
      'blocked', true,
      'attemptsRemaining', 0,
      'retryAfterSeconds', greatest(1, ceil(extract(epoch from (v_retry_at - v_now)))::integer)
    );
  end if;

  if coalesce(p_credentials_valid, false) then
    return jsonb_build_object(
      'allowed', true,
      'authenticated', true,
      'blocked', false,
      'attemptsRemaining', greatest(0, 3 - greatest(v_ip_count, v_device_count))
    );
  end if;

  insert into public.game_admin_login_failures(ip_hash, device_hash, attempted_at)
  values (p_ip_hash, p_device_hash, v_now);
  v_ip_count := v_ip_count + 1;
  v_device_count := v_device_count + 1;

  if v_ip_count >= 3 or v_device_count >= 3 then
    select min(attempted_at) into v_ip_oldest
    from public.game_admin_login_failures
    where ip_hash = p_ip_hash and attempted_at > v_window_start;
    select min(attempted_at) into v_device_oldest
    from public.game_admin_login_failures
    where device_hash = p_device_hash and attempted_at > v_window_start;
    v_retry_at := least(
      case when v_ip_count >= 3 then v_ip_oldest + interval '1 hour' else 'infinity'::timestamptz end,
      case when v_device_count >= 3 then v_device_oldest + interval '1 hour' else 'infinity'::timestamptz end
    );
    return jsonb_build_object(
      'allowed', false,
      'authenticated', false,
      'blocked', true,
      'attemptsRemaining', 0,
      'retryAfterSeconds', greatest(1, ceil(extract(epoch from (v_retry_at - v_now)))::integer)
    );
  end if;

  return jsonb_build_object(
    'allowed', true,
    'authenticated', false,
    'blocked', false,
    'attemptsRemaining', greatest(0, 3 - greatest(v_ip_count, v_device_count))
  );
end;
$$;

comment on function public.zadmin_login_gate(text, text, boolean, timestamptz) is
  'Transactional rolling one-hour zadmin login gate. Retry timing is derived only from subjects that actually reached the three-failure threshold.';
