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
  v_account_id uuid := case
    when p_account_id is null then null
    else public.resolve_game_account_id(p_account_id)
  end;
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

comment on function public.get_game_active_admin_ban_for_subject(uuid, text, text, timestamptz) is
  'Canonical manual restriction lookup. A missing account remains nullable so IP-scoped bans apply before or without account resolution.';
