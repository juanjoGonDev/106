create table if not exists public.game_admin_login_failures (
  id bigint generated always as identity primary key,
  ip_hash text not null check (ip_hash ~ '^[a-f0-9]{64}$'),
  device_hash text not null check (device_hash ~ '^[a-f0-9]{64}$'),
  attempted_at timestamptz not null default clock_timestamp()
);

create index if not exists game_admin_login_failures_ip_window_idx
  on public.game_admin_login_failures(ip_hash, attempted_at desc);
create index if not exists game_admin_login_failures_device_window_idx
  on public.game_admin_login_failures(device_hash, attempted_at desc);

create table if not exists public.game_admin_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  ip_hash text not null check (ip_hash ~ '^[a-f0-9]{64}$'),
  device_hash text not null check (device_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default clock_timestamp(),
  revoked_at timestamptz,
  constraint game_admin_sessions_expiry_check check (expires_at > created_at)
);

create index if not exists game_admin_sessions_token_active_idx
  on public.game_admin_sessions(token_hash, expires_at desc)
  where revoked_at is null;

create table if not exists public.game_admin_bans (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('account', 'nick', 'ip')),
  account_id uuid references public.game_accounts(id) on delete restrict,
  nick_key text,
  ip_hash text,
  reason text not null check (char_length(reason) between 3 and 500),
  created_by_session_id uuid not null references public.game_admin_sessions(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by_session_id uuid references public.game_admin_sessions(id) on delete restrict,
  revoked_reason text check (revoked_reason is null or char_length(revoked_reason) between 3 and 500),
  constraint game_admin_bans_expiry_check check (expires_at is null or expires_at > created_at),
  constraint game_admin_bans_target_check check (
    (scope = 'account' and account_id is not null and nick_key is null and ip_hash is null)
    or (scope = 'nick' and account_id is null and nick_key is not null and ip_hash is null)
    or (scope = 'ip' and account_id is null and nick_key is null and ip_hash ~ '^[a-f0-9]{64}$')
  )
);

create index if not exists game_admin_bans_account_active_idx
  on public.game_admin_bans(account_id, created_at desc)
  where scope = 'account' and revoked_at is null;
create index if not exists game_admin_bans_nick_active_idx
  on public.game_admin_bans(nick_key, created_at desc)
  where scope = 'nick' and revoked_at is null;
create index if not exists game_admin_bans_ip_active_idx
  on public.game_admin_bans(ip_hash, created_at desc)
  where scope = 'ip' and revoked_at is null;

create table if not exists public.game_admin_audit_events (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.game_admin_sessions(id) on delete restrict,
  action text not null check (action in ('ban', 'revoke')),
  target_scope text not null check (target_scope in ('account', 'nick', 'ip')),
  target_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists game_admin_audit_events_created_idx
  on public.game_admin_audit_events(created_at desc, id desc);

alter table public.game_admin_login_failures enable row level security;
alter table public.game_admin_sessions enable row level security;
alter table public.game_admin_bans enable row level security;
alter table public.game_admin_audit_events enable row level security;

revoke all on table
  public.game_admin_login_failures,
  public.game_admin_sessions,
  public.game_admin_bans,
  public.game_admin_audit_events
from public, anon, authenticated, service_role;

grant select on table public.game_admin_bans, public.game_admin_audit_events to service_role;

create or replace view public.game_admin_attempt_facts
with (security_invoker = true)
as
select
  attempt.id,
  attempt.nick,
  attempt.nick_key,
  account_player.account_id,
  attempt.device_hash,
  attempt.ip_hash,
  attempt.difference_ms,
  attempt.verified,
  attempt.verification_reasons,
  attempt.created_at,
  coalesce(integrity.status, case when attempt.verified then 'eligible' else 'excluded' end) as integrity_status,
  coalesce(integrity.risk_score, 0) as risk_score,
  coalesce(integrity.risk_reasons, '{}'::text[]) as risk_reasons,
  coalesce(integrity.evidence, '{}'::jsonb) as integrity_evidence,
  coalesce(integrity.policy_version, 0) as integrity_policy_version,
  integrity.evaluated_at as integrity_evaluated_at
from public.game_attempts attempt
left join public.game_account_players account_player
  on account_player.nick_key = attempt.nick_key
left join public.game_attempt_integrity integrity
  on integrity.attempt_id = attempt.id;

revoke all on table public.game_admin_attempt_facts from public, anon, authenticated;
grant select on table public.game_admin_attempt_facts to service_role;

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
    v_retry_at := least(v_ip_oldest, v_device_oldest) + interval '1 hour';
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

create or replace function public.zadmin_create_session(
  p_token_hash text,
  p_ip_hash text,
  p_device_hash text,
  p_at timestamptz default clock_timestamp()
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := coalesce(p_at, clock_timestamp());
  v_session public.game_admin_sessions%rowtype;
begin
  if coalesce(p_token_hash, '') !~ '^[a-f0-9]{64}$'
     or coalesce(p_ip_hash, '') !~ '^[a-f0-9]{64}$'
     or coalesce(p_device_hash, '') !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('error', 'invalid_session');
  end if;

  insert into public.game_admin_sessions(
    token_hash, ip_hash, device_hash, created_at, expires_at, last_seen_at
  ) values (
    p_token_hash, p_ip_hash, p_device_hash, v_now, v_now + interval '30 minutes', v_now
  ) returning * into v_session;

  return jsonb_build_object(
    'sessionId', v_session.id,
    'expiresAt', v_session.expires_at
  );
end;
$$;

create or replace function public.zadmin_validate_session(
  p_token_hash text,
  p_ip_hash text,
  p_device_hash text,
  p_at timestamptz default clock_timestamp()
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.game_admin_sessions%rowtype;
  v_now timestamptz := coalesce(p_at, clock_timestamp());
begin
  if coalesce(p_token_hash, '') !~ '^[a-f0-9]{64}$'
     or coalesce(p_ip_hash, '') !~ '^[a-f0-9]{64}$'
     or coalesce(p_device_hash, '') !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('valid', false);
  end if;

  update public.game_admin_sessions
  set last_seen_at = v_now
  where token_hash = p_token_hash
    and ip_hash = p_ip_hash
    and device_hash = p_device_hash
    and revoked_at is null
    and expires_at > v_now
  returning * into v_session;

  if not found then return jsonb_build_object('valid', false); end if;
  return jsonb_build_object(
    'valid', true,
    'sessionId', v_session.id,
    'expiresAt', v_session.expires_at
  );
end;
$$;

create or replace function public.zadmin_revoke_session(
  p_session_id uuid,
  p_at timestamptz default clock_timestamp()
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.game_admin_sessions
  set revoked_at = coalesce(p_at, clock_timestamp())
  where id = p_session_id and revoked_at is null;
  return found;
end;
$$;

create or replace function public.zadmin_create_manual_ban(
  p_scope text,
  p_target text,
  p_duration_minutes integer,
  p_reason text,
  p_actor_session_id uuid,
  p_at timestamptz default clock_timestamp()
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_scope text := lower(trim(coalesce(p_scope, '')));
  v_target text := trim(coalesce(p_target, ''));
  v_reason text := trim(coalesce(p_reason, ''));
  v_now timestamptz := coalesce(p_at, clock_timestamp());
  v_account_id uuid;
  v_nick_key text;
  v_ip_hash text;
  v_ban public.game_admin_bans%rowtype;
  v_target_key text;
begin
  if v_scope not in ('account', 'nick', 'ip') then return jsonb_build_object('error', 'invalid_scope'); end if;
  if char_length(v_reason) not between 3 and 500 then return jsonb_build_object('error', 'invalid_reason'); end if;
  if p_duration_minutes is not null and not (
    (p_duration_minutes between 60 and 1440 and mod(p_duration_minutes, 60) = 0)
    or p_duration_minutes = 10080
  ) then return jsonb_build_object('error', 'invalid_duration'); end if;
  if not exists (
    select 1 from public.game_admin_sessions session
    where session.id = p_actor_session_id
      and session.revoked_at is null
      and session.expires_at > v_now
  ) then return jsonb_build_object('error', 'invalid_session'); end if;

  if v_scope = 'account' then
    if v_target !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      return jsonb_build_object('error', 'invalid_target');
    end if;
    v_account_id := public.resolve_game_account_id(v_target::uuid);
    if v_account_id is null then return jsonb_build_object('error', 'target_not_found'); end if;
    v_target_key := v_account_id::text;
  elsif v_scope = 'nick' then
    v_nick_key := lower(v_target);
    if v_nick_key = '' or not exists (
      select 1 from public.game_account_players player where player.nick_key = v_nick_key
    ) then return jsonb_build_object('error', 'target_not_found'); end if;
    v_target_key := v_nick_key;
  else
    v_ip_hash := lower(v_target);
    if v_ip_hash !~ '^[a-f0-9]{64}$' or not exists (
      select 1 from public.game_attempts attempt where attempt.ip_hash = v_ip_hash
    ) then return jsonb_build_object('error', 'target_not_found'); end if;
    v_target_key := v_ip_hash;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('zadmin-ban:' || v_scope || ':' || v_target_key, 0));

  select ban.* into v_ban
  from public.game_admin_bans ban
  where ban.scope = v_scope
    and ban.revoked_at is null
    and (ban.expires_at is null or ban.expires_at > v_now)
    and (
      (v_scope = 'account' and ban.account_id = v_account_id)
      or (v_scope = 'nick' and ban.nick_key = v_nick_key)
      or (v_scope = 'ip' and ban.ip_hash = v_ip_hash)
    )
  order by ban.created_at desc
  limit 1;

  if found then
    return jsonb_build_object('error', 'ban_already_active', 'banId', v_ban.id, 'expiresAt', v_ban.expires_at);
  end if;

  insert into public.game_admin_bans(
    scope, account_id, nick_key, ip_hash, reason, created_by_session_id, created_at, expires_at
  ) values (
    v_scope,
    case when v_scope = 'account' then v_account_id else null end,
    case when v_scope = 'nick' then v_nick_key else null end,
    case when v_scope = 'ip' then v_ip_hash else null end,
    v_reason,
    p_actor_session_id,
    v_now,
    case when p_duration_minutes is null then null else v_now + make_interval(mins => p_duration_minutes) end
  ) returning * into v_ban;

  insert into public.game_admin_audit_events(session_id, action, target_scope, target_key, metadata, created_at)
  values (
    p_actor_session_id,
    'ban',
    v_scope,
    v_target_key,
    jsonb_build_object('banId', v_ban.id, 'reason', v_reason, 'expiresAt', v_ban.expires_at),
    v_now
  );

  return jsonb_build_object(
    'banId', v_ban.id,
    'scope', v_ban.scope,
    'target', v_target_key,
    'reason', v_ban.reason,
    'createdAt', v_ban.created_at,
    'expiresAt', v_ban.expires_at,
    'permanent', v_ban.expires_at is null
  );
end;
$$;

create or replace function public.zadmin_revoke_manual_ban(
  p_ban_id uuid,
  p_reason text,
  p_actor_session_id uuid,
  p_at timestamptz default clock_timestamp()
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text := trim(coalesce(p_reason, ''));
  v_now timestamptz := coalesce(p_at, clock_timestamp());
  v_ban public.game_admin_bans%rowtype;
  v_target_key text;
begin
  if char_length(v_reason) not between 3 and 500 then return jsonb_build_object('error', 'invalid_reason'); end if;
  if not exists (
    select 1 from public.game_admin_sessions session
    where session.id = p_actor_session_id
      and session.revoked_at is null
      and session.expires_at > v_now
  ) then return jsonb_build_object('error', 'invalid_session'); end if;

  select ban.* into v_ban
  from public.game_admin_bans ban
  where ban.id = p_ban_id
  for update;
  if not found then return jsonb_build_object('error', 'ban_not_found'); end if;
  if v_ban.revoked_at is not null then return jsonb_build_object('error', 'ban_already_revoked'); end if;

  update public.game_admin_bans
  set revoked_at = v_now,
      revoked_by_session_id = p_actor_session_id,
      revoked_reason = v_reason
  where id = p_ban_id;

  v_target_key := case v_ban.scope
    when 'account' then v_ban.account_id::text
    when 'nick' then v_ban.nick_key
    else v_ban.ip_hash
  end;

  insert into public.game_admin_audit_events(session_id, action, target_scope, target_key, metadata, created_at)
  values (
    p_actor_session_id,
    'revoke',
    v_ban.scope,
    v_target_key,
    jsonb_build_object('banId', v_ban.id, 'reason', v_reason),
    v_now
  );

  return jsonb_build_object('revoked', true, 'banId', v_ban.id, 'revokedAt', v_now);
end;
$$;

create or replace function public.get_game_active_admin_ban_for_subject(
  p_account_id uuid,
  p_nick_key text,
  p_ip_hash text,
  p_at timestamptz default clock_timestamp()
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_account_id uuid := public.resolve_game_account_id(p_account_id);
  v_nick_key text := lower(trim(coalesce(p_nick_key, '')));
  v_now timestamptz := coalesce(p_at, clock_timestamp());
  v_ban public.game_admin_bans%rowtype;
begin
  select ban.* into v_ban
  from public.game_admin_bans ban
  where ban.revoked_at is null
    and (ban.expires_at is null or ban.expires_at > v_now)
    and (
      (ban.scope = 'account' and v_account_id is not null and ban.account_id = v_account_id)
      or (ban.scope = 'nick' and v_nick_key <> '' and ban.nick_key = v_nick_key)
      or (ban.scope = 'ip' and coalesce(p_ip_hash, '') <> '' and ban.ip_hash = p_ip_hash)
    )
  order by
    case ban.scope when 'account' then 1 when 'nick' then 2 else 3 end,
    ban.expires_at desc nulls first,
    ban.created_at desc
  limit 1;

  if not found then return jsonb_build_object('banned', false); end if;
  return jsonb_build_object(
    'banned', true,
    'source', 'admin',
    'scope', v_ban.scope,
    'banId', v_ban.id,
    'expiresAt', v_ban.expires_at,
    'permanent', v_ban.expires_at is null,
    'retryAfterSeconds', case
      when v_ban.expires_at is null then null
      else greatest(1, ceil(extract(epoch from (v_ban.expires_at - v_now)))::integer)
    end
  );
end;
$$;

create or replace function public.get_game_active_integrity_ban(
  p_nick_key text,
  p_device_hash text,
  p_ip_hash text,
  p_at timestamptz default clock_timestamp()
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_account_id uuid := public.game_account_id_for_nick(p_nick_key);
  v_manual jsonb;
begin
  v_manual := public.get_game_active_admin_ban_for_subject(v_account_id, p_nick_key, p_ip_hash, p_at);
  if coalesce((v_manual->>'banned')::boolean, false) then return v_manual; end if;
  return public.get_game_active_integrity_ban_for_account(v_account_id, p_device_hash, p_ip_hash, p_at);
end;
$$;

create or replace function public.get_game_active_integrity_ban_by_token(
  p_account_token_hash text,
  p_device_hash text,
  p_ip_hash text,
  p_at timestamptz default clock_timestamp()
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_account_id uuid;
  v_manual jsonb;
begin
  if coalesce(p_account_token_hash, '') ~ '^[a-f0-9]{64}$' then
    v_account_id := public.resolve_game_account_token(p_account_token_hash);
  end if;

  v_manual := public.get_game_active_admin_ban_for_subject(v_account_id, null, p_ip_hash, p_at);
  if coalesce((v_manual->>'banned')::boolean, false) then return v_manual; end if;
  return public.get_game_active_integrity_ban_for_account(v_account_id, p_device_hash, p_ip_hash, p_at);
end;
$$;

revoke all on function public.zadmin_login_gate(text, text, boolean, timestamptz) from public, anon, authenticated;
revoke all on function public.zadmin_create_session(text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.zadmin_validate_session(text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.zadmin_revoke_session(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.zadmin_create_manual_ban(text, text, integer, text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.zadmin_revoke_manual_ban(uuid, text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.get_game_active_admin_ban_for_subject(uuid, text, text, timestamptz) from public, anon, authenticated;

grant execute on function public.zadmin_login_gate(text, text, boolean, timestamptz) to service_role;
grant execute on function public.zadmin_create_session(text, text, text, timestamptz) to service_role;
grant execute on function public.zadmin_validate_session(text, text, text, timestamptz) to service_role;
grant execute on function public.zadmin_revoke_session(uuid, timestamptz) to service_role;
grant execute on function public.zadmin_create_manual_ban(text, text, integer, text, uuid, timestamptz) to service_role;
grant execute on function public.zadmin_revoke_manual_ban(uuid, text, uuid, timestamptz) to service_role;
grant execute on function public.get_game_active_admin_ban_for_subject(uuid, text, text, timestamptz) to service_role;

comment on table public.game_admin_bans is
  'Manual operator restrictions. Automatic policy-v3 bans remain in game_integrity_bans; manual rows are retained after revocation for auditability.';
comment on view public.game_admin_attempt_facts is
  'Service-role-only investigation projection joining attempts, canonical account ownership and the existing policy-v3 integrity score/evidence.';
comment on function public.zadmin_login_gate(text, text, boolean, timestamptz) is
  'Transactional rolling one-hour zadmin login gate. Three failed attempts independently block the same IP fingerprint or device fingerprint.';
