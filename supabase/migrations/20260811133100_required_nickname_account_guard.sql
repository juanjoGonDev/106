-- Make a pending moderation rename an account-level authorization prerequisite.
-- This preserves the existing account/player ownership implementation as the
-- domain owner and wraps it with one additional fail-closed moderation gate.

do $$
begin
  if to_regprocedure('public.ensure_game_account_player_without_name_requirement(text,text,text,text,text,text)') is null then
    alter function public.ensure_game_account_player(text, text, text, text, text, text)
      rename to ensure_game_account_player_without_name_requirement;
  end if;
end;
$$;

create or replace function public.ensure_game_account_player(
  p_nick text,
  p_nick_key text,
  p_device_hash text,
  p_ip_hash text,
  p_account_token_hash text,
  p_legacy_token_hash text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_account_id uuid;
  v_required_player uuid;
begin
  if coalesce(p_account_token_hash, '') ~ '^[a-f0-9]{64}$' then
    v_account_id := public.resolve_game_account_token(p_account_token_hash);
  end if;

  if v_account_id is not null then
    select account_player.player_id into v_required_player
    from public.game_account_players account_player
    join public.game_player_name_requirements requirement
      on requirement.player_id = account_player.player_id
    where account_player.account_id = v_account_id
      and requirement.required = true
    order by requirement.requested_at, account_player.player_id
    limit 1;

    if v_required_player is not null then
      return jsonb_build_object(
        'error', 'nickname_change_required',
        'playerId', v_required_player
      );
    end if;
  end if;

  return public.ensure_game_account_player_without_name_requirement(
    p_nick,
    p_nick_key,
    p_device_hash,
    p_ip_hash,
    p_account_token_hash,
    p_legacy_token_hash
  );
end;
$$;

revoke all on function public.ensure_game_account_player_without_name_requirement(text,text,text,text,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.ensure_game_account_player(text,text,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.ensure_game_account_player(text,text,text,text,text,text)
  to service_role;

comment on function public.ensure_game_account_player(text,text,text,text,text,text) is
  'Account/player authorization wrapper. A pending administrator-required nickname change blocks all normal player authorization until the owner completes the rename through the dedicated account-token flow.';
