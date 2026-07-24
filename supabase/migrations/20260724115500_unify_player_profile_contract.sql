create or replace function public.get_game_player_profile(p_nick_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_team text;
  v_daily_total integer;
  v_league_total integer;
  v_history jsonb;
begin
  perform public.sync_game_trophy_history();
  perform public.sync_game_league_trophies();

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
      'history', '[]'::jsonb
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
    'trophies', jsonb_build_object(
      'total', 0, 'days', 0, 'goldenBoot', 0, 'goldenGlove', 0,
      'goldenBall', 0, 'rank', null, 'history', '[]'::jsonb
    ),
    'achievements', jsonb_build_object(
      'total', 0, 'points', 0, 'rank', null, 'items', '[]'::jsonb
    ),
    'history', '[]'::jsonb
  )) into v_result;

  select attempt.team into v_team
  from public.game_attempts attempt
  where attempt.nick_key = p_nick_key
    and attempt.verified = true
    and attempt.league_id is null
  order by attempt.created_at desc, attempt.id desc
  limit 1;

  select count(*)::integer into v_daily_total
  from public.game_daily_trophies trophy
  where trophy.nick_key = p_nick_key;

  select count(*)::integer into v_league_total
  from public.game_league_trophies trophy
  where trophy.nick_key = p_nick_key;

  select coalesce(jsonb_agg(history.item order by history.sort_at desc, history.sort_key), '[]'::jsonb)
  into v_history
  from (
    select jsonb_build_object(
      'type', trophy.trophy_type,
      'date', trophy.award_date,
      'value', trophy.metric_value,
      'attempts', trophy.attempt_count,
      'bestDifferenceMs', trophy.best_difference_ms,
      'averageDifferenceMs', trophy.average_difference_ms
    ) as item,
    trophy.awarded_at as sort_at,
    trophy.trophy_type as sort_key
    from public.game_daily_trophies trophy
    where trophy.nick_key = p_nick_key
    union all
    select jsonb_build_object(
      'type', 'league_champion',
      'date', (league.ends_at at time zone 'Europe/Madrid')::date,
      'value', trophy.best_difference_ms,
      'leagueCode', league.code,
      'leagueName', league.name,
      'participants', trophy.participant_count,
      'awardedAt', trophy.awarded_at
    ) as item,
    trophy.awarded_at as sort_at,
    league.code as sort_key
    from public.game_league_trophies trophy
    join public.game_leagues league on league.id = trophy.league_id
    where trophy.nick_key = p_nick_key
  ) history;

  v_result := jsonb_set(v_result, '{trophies,dailyTotal}', to_jsonb(coalesce(v_daily_total, 0)), true);
  v_result := jsonb_set(v_result, '{trophies,leagueChampion}', to_jsonb(coalesce(v_league_total, 0)), true);
  v_result := jsonb_set(v_result, '{trophies,total}', to_jsonb(coalesce(v_daily_total, 0) + coalesce(v_league_total, 0)), true);
  v_result := jsonb_set(v_result, '{trophies,history}', coalesce(v_history, '[]'::jsonb), true);

  return v_result || jsonb_build_object(
    'team', v_team,
    'profileRevision', public.get_game_profile_revision(p_nick_key),
    'leagueTrophies', jsonb_build_object(
      'total', coalesce(v_league_total, 0),
      'history', coalesce((
        select jsonb_agg(jsonb_build_object(
          'type', 'league_champion',
          'date', (league.ends_at at time zone 'Europe/Madrid')::date,
          'value', trophy.best_difference_ms,
          'leagueCode', league.code,
          'leagueName', league.name,
          'participants', trophy.participant_count,
          'awardedAt', trophy.awarded_at
        ) order by trophy.awarded_at desc, league.code)
        from public.game_league_trophies trophy
        join public.game_leagues league on league.id = trophy.league_id
        where trophy.nick_key = p_nick_key
      ), '[]'::jsonb)
    )
  );
end;
$$;

create or replace function public.get_game_public_profile(p_nick_key text)
returns jsonb
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  select public.get_game_player_profile(p_nick_key);
$$;

revoke all on function public.get_game_player_profile(text) from public, anon, authenticated;
revoke all on function public.get_game_public_profile(text) from public, anon, authenticated;
grant execute on function public.get_game_player_profile(text) to service_role;
grant execute on function public.get_game_public_profile(text) to service_role;
