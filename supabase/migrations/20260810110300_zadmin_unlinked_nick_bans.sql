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
      select 1
      from public.game_attempts attempt
      where attempt.nick_key = v_nick_key
      limit 1
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

comment on function public.zadmin_create_manual_ban(text, text, integer, text, uuid, timestamptz) is
  'Creates audited manual restrictions. Nick targets require real gameplay activity but do not require account ownership, so anonymous players can be restricted by nick.';
