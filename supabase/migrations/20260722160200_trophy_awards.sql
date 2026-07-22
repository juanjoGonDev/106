create or replace function public.award_game_trophies_for_date(p_award_date date)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_today date := (clock_timestamp() at time zone 'Europe/Madrid')::date;
  v_inserted integer := 0;
  v_nick_key text;
begin
  if p_award_date is null or p_award_date >= v_today then
    return 0;
  end if;

  with daily as (
    select id, nick_key, difference_ms, created_at
    from public.game_attempts
    where verified = true
      and league_id is null
      and (created_at at time zone 'Europe/Madrid')::date = p_award_date
  ), best_events as (
    select distinct on (nick_key)
      nick_key, created_at as best_at
    from daily
    order by nick_key, difference_ms, created_at, id
  ), summaries as (
    select d.nick_key,
      count(*)::integer as attempts,
      min(d.difference_ms)::integer as best_difference_ms,
      round(avg(d.difference_ms))::integer as average_difference_ms,
      b.best_at
    from daily d
    join best_events b using (nick_key)
    group by d.nick_key, b.best_at
  ), candidates as (
    (select 'golden_boot'::text as trophy_type, nick_key,
      best_difference_ms as metric_value, attempts, best_difference_ms,
      average_difference_ms
    from summaries
    order by best_difference_ms, best_at, nick_key
    limit 1)
    union all
    (select 'golden_glove'::text, nick_key,
      average_difference_ms, attempts, best_difference_ms,
      average_difference_ms
    from summaries
    where attempts >= 3
    order by average_difference_ms, best_difference_ms, best_at, nick_key
    limit 1)
    union all
    (select 'golden_ball'::text, nick_key,
      attempts, attempts, best_difference_ms,
      average_difference_ms
    from summaries
    order by attempts desc, best_difference_ms, average_difference_ms, best_at, nick_key
    limit 1)
  )
  insert into public.game_daily_trophies(
    award_date, trophy_type, nick_key, metric_value,
    attempt_count, best_difference_ms, average_difference_ms
  )
  select p_award_date, trophy_type, nick_key, metric_value,
    attempts, best_difference_ms, average_difference_ms
  from candidates
  on conflict (award_date, trophy_type) do nothing;

  get diagnostics v_inserted = row_count;

  for v_nick_key in
    select distinct nick_key
    from public.game_daily_trophies
    where award_date = p_award_date
  loop
    perform public.refresh_game_player_achievements(v_nick_key);
  end loop;

  return v_inserted;
end;
$$;

create or replace function public.sync_game_trophy_history(p_through_date date default null)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_today date := (clock_timestamp() at time zone 'Europe/Madrid')::date;
  v_through_date date := least(coalesce(p_through_date, v_today - 1), v_today - 1);
  v_award_date date;
  v_trophy_count integer;
  v_processed integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended('minuto106:trophy-sync', 106));

  for v_award_date in
    select distinct (attempt.created_at at time zone 'Europe/Madrid')::date
    from public.game_attempts attempt
    left join public.game_trophy_award_runs run
      on run.award_date = (attempt.created_at at time zone 'Europe/Madrid')::date
    where attempt.verified = true
      and attempt.league_id is null
      and (attempt.created_at at time zone 'Europe/Madrid')::date <= v_through_date
      and run.award_date is null
    order by 1
  loop
    perform public.award_game_trophies_for_date(v_award_date);
    select count(*)::integer into v_trophy_count
    from public.game_daily_trophies
    where award_date = v_award_date;

    insert into public.game_trophy_award_runs(award_date, trophy_count)
    values (v_award_date, v_trophy_count)
    on conflict (award_date) do nothing;
    v_processed := v_processed + 1;
  end loop;

  return v_processed;
end;
$$;

create or replace function public.get_game_daily_awards()
returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
with today_context as (
  select (clock_timestamp() at time zone 'Europe/Madrid')::date as award_date
), today_attempts as (
  select attempt.*
  from public.game_attempts attempt, today_context context
  where attempt.verified = true
    and attempt.league_id is null
    and (attempt.created_at at time zone 'Europe/Madrid')::date = context.award_date
), best_events as (
  select distinct on (nick_key) nick_key, created_at as best_at
  from today_attempts
  order by nick_key, difference_ms, created_at, id
), summaries as (
  select attempts.nick_key, max(attempts.nick) as nick,
    count(*)::integer as attempts,
    min(attempts.difference_ms)::integer as best_difference_ms,
    round(avg(attempts.difference_ms))::integer as average_difference_ms,
    best.best_at
  from today_attempts attempts
  join best_events best using (nick_key)
  group by attempts.nick_key, best.best_at
), awards as (
  select
    (select jsonb_build_object('nick', nick, 'value', best_difference_ms)
      from summaries order by best_difference_ms, best_at, nick_key limit 1) as golden_boot,
    (select jsonb_build_object('nick', nick, 'value', average_difference_ms)
      from summaries where attempts >= 3
      order by average_difference_ms, best_difference_ms, best_at, nick_key limit 1) as golden_glove,
    (select jsonb_build_object('nick', nick, 'value', attempts)
      from summaries
      order by attempts desc, best_difference_ms, average_difference_ms, best_at, nick_key limit 1) as golden_ball
)
select jsonb_build_object(
  'date', (select award_date from today_context),
  'provisional', true,
  'goldenBoot', golden_boot,
  'goldenGlove', golden_glove,
  'goldenBall', golden_ball
)
from awards;
$$;

create or replace function public.get_game_honours_rankings()
returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
with trophy_counts as (
  select nick_key,
    count(*)::integer as total_trophies,
    count(distinct award_date)::integer as trophy_days,
    count(*) filter (where trophy_type = 'golden_boot')::integer as golden_boot,
    count(*) filter (where trophy_type = 'golden_glove')::integer as golden_glove,
    count(*) filter (where trophy_type = 'golden_ball')::integer as golden_ball,
    max(award_date) as last_trophy_on
  from public.game_daily_trophies
  group by nick_key
), achievement_counts as (
  select nick_key, count(*)::integer as total_achievements,
    coalesce(sum(points), 0)::integer as achievement_points,
    max(achieved_on) as last_achievement_on
  from public.game_player_achievements
  group by nick_key
), combined as (
  select player.nick_key, player.nick,
    coalesce(trophies.total_trophies, 0) as total_trophies,
    coalesce(trophies.trophy_days, 0) as trophy_days,
    coalesce(trophies.golden_boot, 0) as golden_boot,
    coalesce(trophies.golden_glove, 0) as golden_glove,
    coalesce(trophies.golden_ball, 0) as golden_ball,
    trophies.last_trophy_on,
    coalesce(achievements.total_achievements, 0) as total_achievements,
    coalesce(achievements.achievement_points, 0) as achievement_points,
    achievements.last_achievement_on
  from public.game_players player
  left join trophy_counts trophies using (nick_key)
  left join achievement_counts achievements using (nick_key)
  where trophies.nick_key is not null or achievements.nick_key is not null
), trophy_ranked as (
  select *, row_number() over(
    order by total_trophies desc, trophy_days desc, achievement_points desc, nick_key
  )::integer as rank
  from combined
  where total_trophies > 0
), achievement_ranked as (
  select *, row_number() over(
    order by achievement_points desc, total_achievements desc, total_trophies desc, nick_key
  )::integer as rank
  from combined
  where total_achievements > 0
)
select jsonb_build_object(
  'trophies', coalesce((
    select jsonb_agg(jsonb_build_object(
      'rank', rank, 'nick', nick, 'totalTrophies', total_trophies,
      'trophyDays', trophy_days, 'goldenBoot', golden_boot,
      'goldenGlove', golden_glove, 'goldenBall', golden_ball,
      'achievementPoints', achievement_points, 'lastTrophyOn', last_trophy_on
    ) order by rank, nick)
    from (select * from trophy_ranked order by rank, nick limit 100) ranked
  ), '[]'::jsonb),
  'achievements', coalesce((
    select jsonb_agg(jsonb_build_object(
      'rank', rank, 'nick', nick, 'achievementPoints', achievement_points,
      'totalAchievements', total_achievements, 'totalTrophies', total_trophies,
      'lastAchievementOn', last_achievement_on
    ) order by rank, nick)
    from (select * from achievement_ranked order by rank, nick limit 100) ranked
  ), '[]'::jsonb)
);
$$;
