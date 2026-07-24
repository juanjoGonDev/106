create or replace function public.enforce_game_league_identifiers()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.public_id is null then
    new.public_id := new.code;
  end if;

  if new.code is null then
    new.code := new.public_id;
  end if;

  if new.code <> new.public_id then
    raise exception 'game league competition code must equal its public identifier';
  end if;

  if new.join_code is null then
    new.join_code := public.generate_game_league_token();
    while new.join_code = new.public_id loop
      new.join_code := public.generate_game_league_token();
    end loop;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_game_league_identifiers() from public, anon, authenticated;
grant execute on function public.enforce_game_league_identifiers() to service_role;

drop trigger if exists game_leagues_enforce_identifiers on public.game_leagues;
create trigger game_leagues_enforce_identifiers
before insert or update of code, public_id, join_code on public.game_leagues
for each row execute function public.enforce_game_league_identifiers();
