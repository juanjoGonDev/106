create or replace function public.enforce_game_integrity_challenge_ban()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ban jsonb;
begin
  v_ban := public.get_game_active_integrity_ban(
    new.nick_key,
    new.device_hash,
    new.ip_hash,
    clock_timestamp()
  );

  if coalesce((v_ban->>'banned')::boolean, false) then
    raise exception using
      errcode = 'P0001',
      message = 'integrity_banned';
  end if;

  return new;
end;
$$;

drop trigger if exists game_challenge_integrity_ban_guard on public.game_challenges;
create trigger game_challenge_integrity_ban_guard
before insert on public.game_challenges
for each row execute function public.enforce_game_integrity_challenge_ban();

revoke all on function public.enforce_game_integrity_challenge_ban() from public, anon, authenticated, service_role;

comment on function public.enforce_game_integrity_challenge_ban() is
  'Database backstop for every ranked challenge creation path. Edge preflight provides the user-facing 429; direct/bypassed challenge inserts fail closed.';
