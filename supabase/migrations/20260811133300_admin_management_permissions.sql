-- Finalize explicit service-role capabilities after all management wrappers are
-- installed. Browser roles remain denied; append-only history is enforced by
-- database triggers rather than by relying on narrower service grants.

grant select, insert, update, delete on table
  public.game_integrity_ban_admin_actions,
  public.game_player_name_requirements,
  public.game_admin_nickname_actions
to service_role;

grant execute on function public.ensure_game_account_player(text,text,text,text,text,text)
  to service_role;
grant execute on function public.game_integrity_ban_admin_state(bigint)
  to service_role;
grant execute on function public.zadmin_set_integrity_ban_action(bigint,text,text,uuid,timestamptz)
  to service_role;
grant execute on function public.rename_game_player_identity_internal(uuid,text,text)
  to service_role;
grant execute on function public.zadmin_rename_player(uuid,text,text,text,uuid,timestamptz)
  to service_role;
grant execute on function public.zadmin_require_player_rename(uuid,text,uuid,timestamptz)
  to service_role;
grant execute on function public.get_game_account_nickname_requirement(text)
  to service_role;
grant execute on function public.complete_game_player_required_rename(text,uuid,text,text,timestamptz)
  to service_role;
