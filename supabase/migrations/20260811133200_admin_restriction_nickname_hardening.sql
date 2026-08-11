-- Preserve the repository-standard service_role DML contract for game_* tables.
-- Append-only history remains protected by database triggers, not by relying on
-- narrower grants that conflict with the global permission contract.
grant select, insert, update, delete on table
  public.game_integrity_ban_admin_actions,
  public.game_player_name_requirements,
  public.game_admin_nickname_actions
to service_role;

create or replace function public.zadmin_require_player_rename(
  p_player_id uuid,
  p_reason text,
  p_actor_session_id uuid,
  p_at timestamptz default clock_timestamp()
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := coalesce(p_at, clock_timestamp());
  v_reason text := trim(coalesce(p_reason, ''));
  v_key text;
  v_nick text;
  v_result jsonb;
begin
  if char_length(v_reason) not between 3 and 500 then return jsonb_build_object('error', 'invalid_reason'); end if;
  if not exists (
    select 1 from public.game_admin_sessions session
    where session.id = p_actor_session_id
      and session.revoked_at is null
      and session.expires_at > v_now
  ) then return jsonb_build_object('error', 'invalid_session'); end if;
  if not exists (select 1 from public.game_players where player_id = p_player_id) then
    return jsonb_build_object('error', 'player_not_found');
  end if;
  if not exists (
    select 1 from public.game_account_players account_player
    where account_player.player_id = p_player_id
  ) then
    return jsonb_build_object('error', 'player_unlinked');
  end if;

  v_nick := 'Jugador-' || substring(replace(p_player_id::text, '-', '') from 1 for 12);
  v_key := lower(v_nick);
  if exists (select 1 from public.game_players where nick_key = v_key and player_id <> p_player_id) then
    v_nick := 'Jugador-' || substring(replace(p_player_id::text, '-', '') from 1 for 16);
    v_key := lower(v_nick);
  end if;

  v_result := public.rename_game_player_identity_internal(p_player_id, v_nick, v_key);
  if v_result ? 'error' then return v_result; end if;

  insert into public.game_player_name_requirements(
    player_id, required, reason, requested_by_session_id, requested_at, resolved_at, updated_at
  ) values (
    p_player_id, true, v_reason, p_actor_session_id, v_now, null, v_now
  )
  on conflict (player_id) do update
  set required = true,
      reason = excluded.reason,
      requested_by_session_id = excluded.requested_by_session_id,
      requested_at = excluded.requested_at,
      resolved_at = null,
      updated_at = excluded.updated_at;

  insert into public.game_admin_nickname_actions(
    player_id, action, old_nick, old_nick_key, new_nick, new_nick_key, reason, actor_session_id, created_at
  ) values (
    p_player_id, 'require_change', v_result->>'oldNick', v_result->>'oldNickKey',
    v_result->>'newNick', v_result->>'newNickKey', v_reason, p_actor_session_id, v_now
  );

  insert into public.game_admin_audit_events(session_id, action, target_scope, target_key, metadata, created_at)
  values (
    p_actor_session_id, 'require_nick_change', 'player', p_player_id::text,
    jsonb_build_object('oldNick', v_result->>'oldNick', 'temporaryNick', v_result->>'newNick', 'reason', v_reason), v_now
  );

  return v_result || jsonb_build_object('required', true, 'reason', v_reason);
end;
$$;

revoke all on function public.zadmin_require_player_rename(uuid,text,uuid,timestamptz)
  from public, anon, authenticated;
grant execute on function public.zadmin_require_player_rename(uuid,text,uuid,timestamptz)
  to service_role;
