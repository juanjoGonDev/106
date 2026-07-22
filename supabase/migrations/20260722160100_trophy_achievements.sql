create or replace function public.refresh_game_player_achievements(p_nick_key text)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_total integer := 0;
  v_inserted integer := 0;
begin
  if not exists (select 1 from public.game_players where nick_key = p_nick_key) then
    return 0;
  end if;

  insert into public.game_player_achievements(
    nick_key, achievement_code, achievement_kind, title, description,
    points, achieved_on, metadata
  )
  select p_nick_key, 'first_trophy', 'first_trophy', 'Primer trofeo',
    'Conseguiste tu primer trofeo diario.', 10, min(award_date),
    jsonb_build_object('total', count(*))
  from public.game_daily_trophies
  where nick_key = p_nick_key
  having count(*) > 0
  on conflict (nick_key, achievement_code) do nothing;
  get diagnostics v_inserted = row_count;
  v_total := v_total + v_inserted;

  insert into public.game_player_achievements(
    nick_key, achievement_code, achievement_kind, title, description,
    points, achieved_on, metadata
  )
  with ordered_trophies as (
    select award_date,
      row_number() over(order by award_date, awarded_at, trophy_type) as sequence
    from public.game_daily_trophies
    where nick_key = p_nick_key
  )
  select p_nick_key,
    'trophy_total_' || thresholds.threshold,
    'trophy_total',
    thresholds.threshold || ' trofeos',
    'Alcanzaste ' || thresholds.threshold || ' trofeos diarios.',
    thresholds.points,
    reached.award_date,
    jsonb_build_object('threshold', thresholds.threshold)
  from (values (3, 15), (10, 30), (25, 60), (50, 100), (100, 180)) as thresholds(threshold, points)
  join ordered_trophies reached on reached.sequence = thresholds.threshold
  on conflict (nick_key, achievement_code) do nothing;
  get diagnostics v_inserted = row_count;
  v_total := v_total + v_inserted;

  insert into public.game_player_achievements(
    nick_key, achievement_code, achievement_kind, title, description,
    points, achieved_on, trophy_type, metadata
  )
  with ordered_categories as (
    select trophy_type, award_date,
      row_number() over(partition by trophy_type order by award_date, awarded_at) as sequence
    from public.game_daily_trophies
    where nick_key = p_nick_key
  )
  select p_nick_key,
    'category_total_' || reached.trophy_type || '_' || thresholds.threshold,
    'category_total',
    thresholds.threshold || ' · ' || public.game_trophy_label(reached.trophy_type),
    'Ganaste ' || thresholds.threshold || ' veces la categoría ' || public.game_trophy_label(reached.trophy_type) || '.',
    thresholds.points,
    reached.award_date,
    reached.trophy_type,
    jsonb_build_object('threshold', thresholds.threshold, 'category', reached.trophy_type)
  from (values (3, 12), (10, 30), (25, 70)) as thresholds(threshold, points)
  join ordered_categories reached on reached.sequence = thresholds.threshold
  on conflict (nick_key, achievement_code) do nothing;
  get diagnostics v_inserted = row_count;
  v_total := v_total + v_inserted;

  insert into public.game_player_achievements(
    nick_key, achievement_code, achievement_kind, title, description,
    points, achieved_on, metadata
  )
  with trophy_days as (
    select distinct award_date
    from public.game_daily_trophies
    where nick_key = p_nick_key
  ), numbered as (
    select award_date,
      award_date - row_number() over(order by award_date)::integer as island_key
    from trophy_days
  ), streaks as (
    select min(award_date) as starts_on, max(award_date) as ends_on, count(*)::integer as length
    from numbered
    group by island_key
  )
  select p_nick_key,
    'trophy_streak_' || threshold,
    'trophy_streak',
    threshold || ' días seguidos',
    'Ganaste al menos un trofeo durante ' || threshold || ' días consecutivos.',
    points,
    min(starts_on + (threshold - 1)),
    jsonb_build_object('threshold', threshold)
  from streaks
  cross join (values (2, 10), (3, 20), (7, 60), (14, 120), (30, 250)) as thresholds(threshold, points)
  where length >= threshold
  group by threshold, points
  on conflict (nick_key, achievement_code) do nothing;
  get diagnostics v_inserted = row_count;
  v_total := v_total + v_inserted;

  insert into public.game_player_achievements(
    nick_key, achievement_code, achievement_kind, title, description,
    points, achieved_on, trophy_type, metadata
  )
  with monthly_first as (
    select nick_key, trophy_type, award_date,
      row_number() over(
        partition by trophy_type, date_trunc('month', award_date::timestamp)
        order by award_date, awarded_at, nick_key
      ) as position
    from public.game_daily_trophies
  )
  select p_nick_key,
    'first_of_month_' || trophy_type || '_' || to_char(award_date, 'YYYY_MM'),
    'first_of_month',
    'Primero del mes · ' || public.game_trophy_label(trophy_type),
    'Fuiste el primer ganador mensual de ' || public.game_trophy_label(trophy_type) || '.',
    25,
    award_date,
    trophy_type,
    jsonb_build_object('month', to_char(award_date, 'YYYY-MM'), 'category', trophy_type)
  from monthly_first
  where position = 1 and nick_key = p_nick_key
  on conflict (nick_key, achievement_code) do nothing;
  get diagnostics v_inserted = row_count;
  v_total := v_total + v_inserted;

  insert into public.game_player_achievements(
    nick_key, achievement_code, achievement_kind, title, description,
    points, achieved_on, metadata
  )
  select p_nick_key, 'complete_set', 'complete_set', 'Colección completa',
    'Has ganado Bota, Guante y Balón de Oro al menos una vez.', 50,
    max(first_date), jsonb_build_object('categories', 3)
  from (
    select trophy_type, min(award_date) as first_date
    from public.game_daily_trophies
    where nick_key = p_nick_key
    group by trophy_type
  ) categories
  having count(*) = 3
  on conflict (nick_key, achievement_code) do nothing;
  get diagnostics v_inserted = row_count;
  v_total := v_total + v_inserted;

  insert into public.game_player_achievements(
    nick_key, achievement_code, achievement_kind, title, description,
    points, achieved_on, metadata
  )
  select p_nick_key,
    'daily_hat_trick_' || to_char(award_date, 'YYYY_MM_DD'),
    'daily_hat_trick',
    'Triplete de Oro',
    'Ganaste los tres trofeos el mismo día.',
    100,
    award_date,
    jsonb_build_object('date', award_date)
  from public.game_daily_trophies
  where nick_key = p_nick_key
  group by award_date
  having count(distinct trophy_type) = 3
  on conflict (nick_key, achievement_code) do nothing;
  get diagnostics v_inserted = row_count;
  v_total := v_total + v_inserted;

  return v_total;
end;
$$;
