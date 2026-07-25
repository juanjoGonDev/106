create table if not exists public.game_player_featured_achievements (
  nick_key text not null references public.game_players(nick_key) on delete cascade,
  achievement_code text not null,
  position smallint not null check (position between 1 and 3),
  active boolean not null default true,
  selected_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (nick_key, achievement_code)
);

do $$
declare
  v_expected_columns integer;
  v_relation_kind "char";
begin
  if to_regclass('public.player_achievement_highlights') is null then
    return;
  end if;

  select relation.relkind
  into v_relation_kind
  from pg_class relation
  join pg_namespace namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public'
    and relation.relname = 'player_achievement_highlights';

  if v_relation_kind not in ('r', 'p') then
    raise exception 'public.player_achievement_highlights exists but is not a table';
  end if;

  select count(*)::integer
  into v_expected_columns
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'player_achievement_highlights'
    and column_name in (
      'player_nick_key',
      'achievement_code',
      'position',
      'created_at',
      'updated_at'
    );

  if v_expected_columns <> 5 then
    raise exception 'public.player_achievement_highlights has an unsupported schema';
  end if;

  with ranked_legacy as (
    select
      legacy.player_nick_key as nick_key,
      legacy.achievement_code,
      row_number() over (
        partition by legacy.player_nick_key
        order by legacy.position, legacy.achievement_code
      )::smallint as normalized_position,
      coalesce(legacy.created_at, clock_timestamp()) as selected_at,
      coalesce(legacy.updated_at, legacy.created_at, clock_timestamp()) as updated_at
    from public.player_achievement_highlights legacy
    join public.game_players player
      on player.nick_key = legacy.player_nick_key
    join public.game_player_achievements achievement
      on achievement.nick_key = legacy.player_nick_key
     and achievement.achievement_code = legacy.achievement_code
    where legacy.position between 1 and 3
      and not exists (
        select 1
        from public.game_player_featured_achievements current_selection
        where current_selection.nick_key = legacy.player_nick_key
          and current_selection.active = true
      )
  )
  insert into public.game_player_featured_achievements (
    nick_key,
    achievement_code,
    position,
    active,
    selected_at,
    updated_at
  )
  select
    legacy.nick_key,
    legacy.achievement_code,
    legacy.normalized_position,
    true,
    legacy.selected_at,
    legacy.updated_at
  from ranked_legacy legacy
  where legacy.normalized_position <= 3
  on conflict (nick_key, achievement_code) do update
  set position = excluded.position,
      active = true,
      selected_at = excluded.selected_at,
      updated_at = excluded.updated_at;

  alter table public.player_achievement_highlights enable row level security;
  revoke all on table public.player_achievement_highlights from public, anon, authenticated;
  grant select on table public.player_achievement_highlights to service_role;
end;
$$;
