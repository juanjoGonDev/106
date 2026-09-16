grant select, insert, update, delete on table public.game_admin_attempt_actions to service_role;

revoke all on sequence public.game_admin_attempt_actions_id_seq from public, anon, authenticated;
grant usage, select, update on sequence public.game_admin_attempt_actions_id_seq to service_role;

create or replace function public.game_admin_attempt_actions_append_only_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'game_admin_attempt_actions is append-only';
end;
$$;

drop trigger if exists game_admin_attempt_actions_append_only on public.game_admin_attempt_actions;
create trigger game_admin_attempt_actions_append_only
before update or delete on public.game_admin_attempt_actions
for each row execute function public.game_admin_attempt_actions_append_only_guard();

revoke all on function public.game_admin_attempt_actions_append_only_guard() from public, anon, authenticated;

comment on function public.game_admin_attempt_actions_append_only_guard() is
  'Rejects mutation or deletion of individual admin attempt-review history even when the trusted service role has the repository-wide game-table DML capability.';
