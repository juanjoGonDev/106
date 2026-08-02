create or replace function public.get_game_daily_awards()
returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
with today_context as (
  select
    public.game_server_day(clock_timestamp()) as award_date,
    public.game_server_reset_at(public.game_server_day(clock_timestamp())) as reset_at
), today_attempts as (
  select attempt.*
  from public.game_attempts attempt, today_context context
  where attempt.verified = true
    and attempt.league_id is null
    and public.game_server_day(attempt.created_at) = context.award_date
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
  'date', context.award_date,
  'resetAt', context.reset_at,
  'provisional', true,
  'goldenBoot', awards.golden_boot,
  'goldenGlove', awards.golden_glove,
  'goldenBall', awards.golden_ball
)
from awards
cross join today_context context;
$$;

revoke all on function public.get_game_daily_awards() from public, anon, authenticated;
grant execute on function public.get_game_daily_awards() to service_role;

comment on function public.get_game_daily_awards() is
  'Returns provisional global awards and their canonical Europe/Madrid reset instant.';
