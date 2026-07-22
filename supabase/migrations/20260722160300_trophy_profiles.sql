create or replace function public.get_game_player_profile(p_nick_key text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_result jsonb;
begin
  perform public.sync_game_trophy_history();

  with player_attempts as (
    select * from public.game_attempts where nick_key = p_nick_key and league_id is null
  ), verified_attempts as (
    select * from player_attempts where verified = true
  ), player_summary as (
    select count(*)::integer as verified_count,
      round(avg(difference_ms))::integer as average_difference_ms,
      min(difference_ms)::integer as best_difference_ms
    from verified_attempts
  ), all_summaries as (
    select nick_key,
      round(avg(difference_ms))::integer as average_difference_ms,
      min(difference_ms)::integer as best_difference_ms
    from public.game_attempts
    where verified = true and league_id is null
    group by nick_key
  ), ranked as (
    select nick_key,
      dense_rank() over(order by average_difference_ms, best_difference_ms, nick_key)::integer as average_rank,
      dense_rank() over(order by best_difference_ms, average_difference_ms, nick_key)::integer as best_rank
    from all_summaries
  ), trophy_counts as (
    select nick_key, count(*)::integer as total,
      count(distinct award_date)::integer as days,
      count(*) filter (where trophy_type = 'golden_boot')::integer as golden_boot,
      count(*) filter (where trophy_type = 'golden_glove')::integer as golden_glove,
      count(*) filter (where trophy_type = 'golden_ball')::integer as golden_ball
    from public.game_daily_trophies
    group by nick_key
  ), achievement_counts as (
    select nick_key, count(*)::integer as total, coalesce(sum(points), 0)::integer as points
    from public.game_player_achievements
    group by nick_key
  ), honour_counts as (
    select coalesce(trophies.nick_key, achievements.nick_key) as nick_key,
      coalesce(trophies.total, 0) as trophy_total,
      coalesce(trophies.days, 0) as trophy_days,
      coalesce(achievements.total, 0) as achievement_total,
      coalesce(achievements.points, 0) as achievement_points
    from trophy_counts trophies
    full join achievement_counts achievements using (nick_key)
  ), trophy_ranks as (
    select nick_key, row_number() over(
      order by trophy_total desc, trophy_days desc, achievement_points desc, nick_key
    )::integer as rank
    from honour_counts
    where trophy_total > 0
  ), achievement_ranks as (
    select nick_key, row_number() over(
      order by achievement_points desc, achievement_total desc, trophy_total desc, nick_key
    )::integer as rank
    from honour_counts
    where achievement_total > 0
  ), base as (
    select player.nick, player.referral_code,
      coalesce(bonus.bonus_attempts, 0)::integer as bonus_attempts,
      (select count(*)::integer from player_attempts) as attempts_used,
      (select count(*)::integer from public.game_referrals where referrer_nick_key = player.nick_key and completed_at is not null) as completed_referrals,
      (select count(*)::integer from all_summaries) as total_players,
      summary.verified_count, summary.average_difference_ms, summary.best_difference_ms,
      ranked.average_rank, ranked.best_rank,
      coalesce(trophies.total, 0) as trophy_total,
      coalesce(trophies.days, 0) as trophy_days,
      coalesce(trophies.golden_boot, 0) as golden_boot,
      coalesce(trophies.golden_glove, 0) as golden_glove,
      coalesce(trophies.golden_ball, 0) as golden_ball,
      trophy_ranks.rank as trophy_rank,
      coalesce(achievements.total, 0) as achievement_total,
      coalesce(achievements.points, 0) as achievement_points,
      achievement_ranks.rank as achievement_rank
    from public.game_players player
    left join public.game_player_bonus bonus on bonus.nick_key = player.nick_key
    cross join player_summary summary
    left join ranked on ranked.nick_key = player.nick_key
    left join trophy_counts trophies on trophies.nick_key = player.nick_key
    left join trophy_ranks on trophy_ranks.nick_key = player.nick_key
    left join achievement_counts achievements on achievements.nick_key = player.nick_key
    left join achievement_ranks on achievement_ranks.nick_key = player.nick_key
    where player.nick_key = p_nick_key
  )
  select coalesce((select jsonb_build_object(
    'nick', nick,
    'referralCode', referral_code,
    'bonusAttempts', bonus_attempts,
    'maxAttempts', 5 + bonus_attempts,
    'attemptsUsed', attempts_used,
    'attemptsLeft', greatest(0, 5 + bonus_attempts - attempts_used),
    'verifiedAttempts', verified_count,
    'averageDifferenceMs', average_difference_ms,
    'bestDifferenceMs', best_difference_ms,
    'globalRankAverage', average_rank,
    'globalRankBest', best_rank,
    'totalPlayers', total_players,
    'completedReferrals', completed_referrals,
    'trophies', jsonb_build_object(
      'total', trophy_total,
      'days', trophy_days,
      'goldenBoot', golden_boot,
      'goldenGlove', golden_glove,
      'goldenBall', golden_ball,
      'rank', trophy_rank,
      'history', coalesce((select jsonb_agg(jsonb_build_object(
        'type', trophy.trophy_type,
        'date', trophy.award_date,
        'value', trophy.metric_value,
        'attempts', trophy.attempt_count,
        'bestDifferenceMs', trophy.best_difference_ms,
        'averageDifferenceMs', trophy.average_difference_ms
      ) order by trophy.award_date desc, trophy.trophy_type)
      from (select * from public.game_daily_trophies where nick_key = p_nick_key order by award_date desc, trophy_type limit 50) trophy), '[]'::jsonb)
    ),
    'achievements', jsonb_build_object(
      'total', achievement_total,
      'points', achievement_points,
      'rank', achievement_rank,
      'items', coalesce((select jsonb_agg(jsonb_build_object(
        'code', achievement.achievement_code,
        'kind', achievement.achievement_kind,
        'title', achievement.title,
        'description', achievement.description,
        'points', achievement.points,
        'date', achievement.achieved_on,
        'trophyType', achievement.trophy_type,
        'metadata', achievement.metadata
      ) order by achievement.achieved_on desc, achievement.points desc, achievement.achievement_code)
      from (select * from public.game_player_achievements where nick_key = p_nick_key order by achieved_on desc, points desc limit 100) achievement), '[]'::jsonb)
    ),
    'history', coalesce((select jsonb_agg(jsonb_build_object(
      'id', attempt.id, 'team', attempt.team, 'elapsedMs', attempt.client_elapsed_ms,
      'differenceMs', attempt.difference_ms, 'verified', attempt.verified,
      'createdAt', attempt.created_at, 'competitionType', 'global'
    ) order by attempt.created_at desc)
    from (select * from player_attempts order by created_at desc limit 20) attempt), '[]'::jsonb)
  ) from base), jsonb_build_object(
    'attemptsUsed', 0, 'attemptsLeft', 5, 'maxAttempts', 5,
    'verifiedAttempts', 0, 'bonusAttempts', 0, 'completedReferrals', 0,
    'totalPlayers', (select count(*)::integer from all_summaries),
    'trophies', jsonb_build_object('total', 0, 'days', 0, 'goldenBoot', 0, 'goldenGlove', 0, 'goldenBall', 0, 'rank', null, 'history', '[]'::jsonb),
    'achievements', jsonb_build_object('total', 0, 'points', 0, 'rank', null, 'items', '[]'::jsonb),
    'history', '[]'::jsonb
  )) into v_result;

  return v_result;
end;
$$;

create or replace function public.get_game_stats()
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_result jsonb;
begin
  perform public.sync_game_trophy_history();

  with best as (
    select distinct on (team, nick_key)
      id, nick, nick_key, team, client_elapsed_ms, difference_ms, created_at
    from public.game_attempts
    where verified = true and league_id is null
    order by team, nick_key, difference_ms, created_at
  ), team_list(team) as (values ('spain'::text), ('argentina'::text)),
  team_stats as (
    select teams.team,
      (select count(*)::integer from public.game_attempts attempt where attempt.team = teams.team and attempt.league_id is null) as attempts,
      count(best.id)::integer as players,
      case when count(best.id) > 0 then round(avg(best.difference_ms))::integer else null end as average_difference_ms,
      coalesce(sum(greatest(1, 100 - floor(best.difference_ms / 10.0)::integer)), 0)::bigint as score
    from team_list teams left join best on best.team = teams.team group by teams.team
  ), leaderboard as (
    select * from best order by difference_ms, created_at limit 10
  )
  select jsonb_build_object(
    'targetMs', 10600,
    'maxAttemptsPerNick', 5,
    'scoreVersion', 2,
    'scoreMaxPerPlayer', 100,
    'totalAttempts', (select count(*)::integer from public.game_attempts where league_id is null),
    'verifiedAttempts', (select count(*)::integer from public.game_attempts where verified = true and league_id is null),
    'totalPlayers', (select count(distinct nick_key)::integer from public.game_attempts where verified = true and league_id is null),
    'perfectAttempts', (select count(*)::integer from public.game_attempts where verified = true and difference_ms = 0 and league_id is null),
    'teams', coalesce((select jsonb_agg(jsonb_build_object(
      'team', team, 'attempts', attempts, 'players', players,
      'averageDifferenceMs', average_difference_ms, 'score', score
    ) order by case team when 'spain' then 1 else 2 end) from team_stats), '[]'::jsonb),
    'leaderboard', coalesce((select jsonb_agg(jsonb_build_object(
      'id', id, 'nick', nick, 'team', team, 'elapsedMs', client_elapsed_ms,
      'differenceMs', difference_ms, 'createdAt', created_at
    ) order by difference_ms, created_at) from leaderboard), '[]'::jsonb),
    'honoursRankings', public.get_game_honours_rankings()
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.game_trophy_label(text) from public, anon, authenticated;
revoke all on function public.refresh_game_player_achievements(text) from public, anon, authenticated;
revoke all on function public.award_game_trophies_for_date(date) from public, anon, authenticated;
revoke all on function public.sync_game_trophy_history(date) from public, anon, authenticated;
revoke all on function public.get_game_daily_awards() from public, anon, authenticated;
revoke all on function public.get_game_honours_rankings() from public, anon, authenticated;
revoke all on function public.get_game_player_profile(text) from public, anon, authenticated;
revoke all on function public.get_game_stats() from public, anon, authenticated;
grant execute on function public.game_trophy_label(text) to service_role;
grant execute on function public.refresh_game_player_achievements(text) to service_role;
grant execute on function public.award_game_trophies_for_date(date) to service_role;
grant execute on function public.sync_game_trophy_history(date) to service_role;
grant execute on function public.get_game_daily_awards() to service_role;
grant execute on function public.get_game_honours_rankings() to service_role;
grant execute on function public.get_game_player_profile(text) to service_role;
grant execute on function public.get_game_stats() to service_role;

select public.sync_game_trophy_history();
