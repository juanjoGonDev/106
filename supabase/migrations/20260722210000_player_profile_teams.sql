create or replace function public.get_game_public_profile(p_nick_key text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_profile jsonb;
  v_team text;
begin
  v_profile := public.get_game_player_profile(p_nick_key);
  select attempt.team into v_team
  from public.game_attempts attempt
  where attempt.nick_key = p_nick_key
    and attempt.verified = true
    and attempt.league_id is null
  order by attempt.created_at desc, attempt.id desc
  limit 1;

  return v_profile || jsonb_build_object('team', v_team);
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
), latest_team as (
  select distinct on (attempt.nick_key) attempt.nick_key, attempt.team
  from public.game_attempts attempt
  where attempt.verified = true and attempt.league_id is null
  order by attempt.nick_key, attempt.created_at desc, attempt.id desc
), awards as (
  select
    (select jsonb_build_object('nick', summary.nick, 'team', team.team, 'value', summary.best_difference_ms)
      from summaries summary left join latest_team team using (nick_key)
      order by summary.best_difference_ms, summary.best_at, summary.nick_key limit 1) as golden_boot,
    (select jsonb_build_object('nick', summary.nick, 'team', team.team, 'value', summary.average_difference_ms)
      from summaries summary left join latest_team team using (nick_key)
      where summary.attempts >= 3
      order by summary.average_difference_ms, summary.best_difference_ms, summary.best_at, summary.nick_key limit 1) as golden_glove,
    (select jsonb_build_object('nick', summary.nick, 'team', team.team, 'value', summary.attempts)
      from summaries summary left join latest_team team using (nick_key)
      order by summary.attempts desc, summary.best_difference_ms, summary.average_difference_ms, summary.best_at, summary.nick_key limit 1) as golden_ball
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
), latest_team as (
  select distinct on (attempt.nick_key) attempt.nick_key, attempt.team
  from public.game_attempts attempt
  where attempt.verified = true and attempt.league_id is null
  order by attempt.nick_key, attempt.created_at desc, attempt.id desc
), combined as (
  select player.nick_key, player.nick, team.team,
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
  left join latest_team team using (nick_key)
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
      'rank', rank, 'nick', nick, 'team', team, 'totalTrophies', total_trophies,
      'trophyDays', trophy_days, 'goldenBoot', golden_boot,
      'goldenGlove', golden_glove, 'goldenBall', golden_ball,
      'achievementPoints', achievement_points, 'lastTrophyOn', last_trophy_on
    ) order by rank, nick)
    from (select * from trophy_ranked order by rank, nick limit 100) ranked
  ), '[]'::jsonb),
  'achievements', coalesce((
    select jsonb_agg(jsonb_build_object(
      'rank', rank, 'nick', nick, 'team', team, 'achievementPoints', achievement_points,
      'totalAchievements', total_achievements, 'totalTrophies', total_trophies,
      'lastAchievementOn', last_achievement_on
    ) order by rank, nick)
    from (select * from achievement_ranked order by rank, nick limit 100) ranked
  ), '[]'::jsonb)
);
$$;

revoke all on function public.get_game_public_profile(text) from public, anon, authenticated;
revoke all on function public.get_game_daily_awards() from public, anon, authenticated;
revoke all on function public.get_game_honours_rankings() from public, anon, authenticated;
grant execute on function public.get_game_public_profile(text) to service_role;
grant execute on function public.get_game_daily_awards() to service_role;
grant execute on function public.get_game_honours_rankings() to service_role;