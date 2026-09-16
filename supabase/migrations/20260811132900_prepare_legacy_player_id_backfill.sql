-- Prepare stable player IDs without updating legacy player rows.
--
-- Production can contain historical players created before the current
-- nickname-shape CHECK constraint. Those rows remain valid history, but any
-- later UPDATE would re-evaluate the CHECK even when the nickname is unchanged.
-- Adding the UUID with a default materializes the new value through DDL instead
-- of an UPDATE, so the following 20260811133000 migration can keep its normal
-- player_id backfill statement as a no-op for existing rows.

alter table public.game_players
  add column if not exists player_id uuid default gen_random_uuid();

alter table public.game_players
  alter column player_id set default gen_random_uuid(),
  alter column player_id set not null;

do $$
begin
  if exists (
    select 1
    from public.game_players
    where player_id is null
  ) then
    raise exception 'legacy player_id preparation left null player identifiers';
  end if;
end;
$$;
