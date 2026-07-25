create table if not exists public.game_player_featured_achievements (
  nick_key text not null references public.game_players(nick_key) on delete cascade,
  achievement_code text not null,
  position smallint not null check (position between 1 and 3),
  active boolean not null default true,
  selected_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (nick_key, achievement_code)
);

create unique index if not exists game_player_featured_achievements_active_position_key
  on public.game_player_featured_achievements(nick_key, position)
  where active = true;

create index if not exists game_player_featured_achievements_profile_revision_idx
  on public.game_player_featured_achievements(nick_key, updated_at desc);

alter table public.game_player_featured_achievements enable row level security;

create or replace function public.get_game_player_featured_achievements(p_nick_key text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'code', achievement.achievement_code,
    'kind', achievement.achievement_kind,
    'title', achievement.title,
    'description', achievement.description,
    'points', achievement.points,
    'date', achievement.achieved_on,
    'metadata', achievement.metadata,
    'position', featured.position
  ) order by featured.position), '[]'::jsonb)
  from public.game_player_featured_achievements featured
  join public.game_player_achievements achievement
    on achievement.nick_key = featured.nick_key
   and achievement.achievement_code = featured.achievement_code
  where featured.nick_key = p_nick_key
    and featured.active = true;
$$;

create or replace function public.set_game_player_featured_achievements(
  p_nick_key text,
  p_achievement_codes text[]
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_codes text[] := coalesce(p_achievement_codes, array[]::text[]);
  v_now timestamptz := clock_timestamp();
begin
  perform pg_advisory_xact_lock(hashtextextended(p_nick_key, 10603));

  if not exists (select 1 from public.game_players where nick_key = p_nick_key) then
    return jsonb_build_object('error', 'player_not_found');
  end if;

  if cardinality(v_codes) > 3 then
    return jsonb_build_object('error', 'featured_limit');
  end if;

  if exists (
    select 1
    from unnest(v_codes) as code(value)
    where code.value is null
       or code.value !~ '^[a-z0-9_]{1,120}$'
  ) then
    return jsonb_build_object('error', 'invalid_featured_achievement');
  end if;

  if cardinality(v_codes) <> (
    select count(distinct code.value)::integer from unnest(v_codes) as code(value)
  ) then
    return jsonb_build_object('error', 'duplicate_featured_achievement');
  end if;

  if exists (
    select 1
    from unnest(v_codes) as code(value)
    where not exists (
      select 1
      from public.game_player_achievements achievement
      where achievement.nick_key = p_nick_key
        and achievement.achievement_code = code.value
    )
  ) then
    return jsonb_build_object('error', 'achievement_not_unlocked');
  end if;

  update public.game_player_featured_achievements
  set active = false,
      updated_at = v_now
  where nick_key = p_nick_key
    and active = true;

  insert into public.game_player_featured_achievements(
    nick_key,
    achievement_code,
    position,
    active,
    selected_at,
    updated_at
  )
  select p_nick_key,
    code.value,
    code.ordinality::smallint,
    true,
    v_now,
    v_now
  from unnest(v_codes) with ordinality as code(value, ordinality)
  on conflict (nick_key, achievement_code) do update
  set position = excluded.position,
      active = true,
      selected_at = excluded.selected_at,
      updated_at = excluded.updated_at;

  return jsonb_build_object(
    'featuredAchievements', public.get_game_player_featured_achievements(p_nick_key)
  );
end;
$$;

create or replace function public.get_game_player_honours_progress(p_nick_key text)
returns jsonb
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
with today_window as (
  select (clock_timestamp() at time zone 'Europe/Madrid')::date as today
), today_attempts as (
  select attempt.*
  from public.game_attempts attempt
  cross join today_window day_window
  where attempt.verified = true
    and attempt.league_id is null
    and (attempt.created_at at time zone 'Europe/Madrid')::date = day_window.today
), today_summary as (
  select attempt.nick_key,
    max(attempt.nick) as nick,
    count(*)::integer as attempts,
    min(attempt.difference_ms)::integer as best_difference_ms,
    round(avg(attempt.difference_ms))::integer as average_difference_ms
  from today_attempts attempt
  group by attempt.nick_key
), today_best as (
  select distinct on (attempt.nick_key)
    attempt.nick_key,
    attempt.created_at as best_at
  from today_attempts attempt
  order by attempt.nick_key, attempt.difference_ms, attempt.created_at, attempt.id
), today_players as (
  select summary.*, best.best_at
  from today_summary summary
  join today_best best using (nick_key)
), boot_leader as (
  select *
  from today_players
  order by best_difference_ms, best_at, nick_key
  limit 1
), glove_leader as (
  select *
  from today_players
  where attempts >= 3
  order by average_difference_ms, best_difference_ms, best_at, nick_key
  limit 1
), ball_leader as (
  select *
  from today_players
  order by attempts desc, best_difference_ms, average_difference_ms, best_at, nick_key
  limit 1
), trophy_days as (
  select distinct trophy.award_date
  from public.game_daily_trophies trophy
  where trophy.nick_key = p_nick_key
), numbered_trophy_days as (
  select award_date,
    award_date - row_number() over(order by award_date)::integer as island_key
  from trophy_days
), trophy_streaks as (
  select count(*)::integer as length
  from numbered_trophy_days
  group by island_key
), completed_leagues as (
  select count(distinct league.id)::integer as total
  from public.game_leagues league
  join public.game_league_trophies trophy on trophy.league_id = league.id
  where exists (
    select 1
    from public.game_attempts attempt
    where attempt.league_id = league.id
      and attempt.nick_key = p_nick_key
      and attempt.verified = true
  )
), duel_totals as (
  select
    count(*) filter (where duel.challenger_nick_key = p_nick_key)::integer as created,
    count(*) filter (
      where duel.status = 'completed'
        and duel.completed_at is not null
        and (
          (
            duel.challenger_nick_key = p_nick_key
            and coalesce(duel.opponent_best_difference_ms, 2147483647) >= duel.challenger_best_difference_ms
          )
          or (
            duel.opponent_nick_key = p_nick_key
            and duel.opponent_best_difference_ms < duel.challenger_best_difference_ms
          )
        )
    )::integer as won
  from public.game_duels duel
), player_today as (
  select * from today_players where nick_key = p_nick_key
)
select jsonb_build_object(
  'perfectAttempts', (
    select count(*)::integer
    from public.game_attempts attempt
    where attempt.nick_key = p_nick_key
      and attempt.verified = true
      and attempt.difference_ms = 0
  ),
  'verifiedAttempts', (
    select count(*)::integer
    from public.game_attempts attempt
    where attempt.nick_key = p_nick_key
      and attempt.verified = true
  ),
  'completedReferrals', (
    select count(*)::integer
    from public.game_referrals referral
    where referral.referrer_nick_key = p_nick_key
      and referral.completed_at is not null
  ),
  'duelsCreated', coalesce((select created from duel_totals), 0),
  'duelsWon', coalesce((select won from duel_totals), 0),
  'completedLeagues', coalesce((select total from completed_leagues), 0),
  'longestTrophyStreak', coalesce((select max(length) from trophy_streaks), 0),
  'trophyCategoryCount', (
    select count(distinct trophy.trophy_type)::integer
    from public.game_daily_trophies trophy
    where trophy.nick_key = p_nick_key
  ),
  'maxDailyTrophyCategories', coalesce((
    select max(day_total)::integer
    from (
      select count(distinct trophy.trophy_type)::integer as day_total
      from public.game_daily_trophies trophy
      where trophy.nick_key = p_nick_key
      group by trophy.award_date
    ) daily_totals
  ), 0),
  'today', jsonb_build_object(
    'date', (select today from today_window),
    'attempts', coalesce((select attempts from player_today), 0),
    'bestDifferenceMs', (select best_difference_ms from player_today),
    'averageDifferenceMs', (select average_difference_ms from player_today),
    'goldenBoot', jsonb_build_object(
      'leaderNick', (select nick from boot_leader),
      'targetDifferenceMs', (select best_difference_ms from boot_leader),
      'leading', coalesce((select nick_key = p_nick_key from boot_leader), false)
    ),
    'goldenGlove', jsonb_build_object(
      'requiredAttempts', 3,
      'eligible', coalesce((select attempts >= 3 from player_today), false),
      'leaderNick', (select nick from glove_leader),
      'targetAverageDifferenceMs', (select average_difference_ms from glove_leader),
      'leading', coalesce((select nick_key = p_nick_key from glove_leader), false)
    ),
    'goldenBall', jsonb_build_object(
      'leaderNick', (select nick from ball_leader),
      'targetAttempts', coalesce((select attempts from ball_leader), 0),
      'leading', coalesce((select nick_key = p_nick_key from ball_leader), false)
    )
  )
);
$$;

alter function public.get_game_player_profile(text)
  rename to get_game_player_profile_before_honours_customization;

create or replace function public.get_game_player_profile(p_nick_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile jsonb;
  v_achievements jsonb;
  v_featured jsonb;
  v_progress jsonb;
  v_selection_revision bigint := 0;
  v_profile_revision bigint := 0;
begin
  v_profile := public.get_game_player_profile_before_honours_customization(p_nick_key);
  if not coalesce(v_profile ? 'nick', false) then
    return v_profile;
  end if;

  v_featured := public.get_game_player_featured_achievements(p_nick_key);
  v_progress := public.get_game_player_honours_progress(p_nick_key);
  v_achievements := coalesce(v_profile->'achievements', '{}'::jsonb)
    || jsonb_build_object('featured', v_featured);

  select coalesce(floor(extract(epoch from max(featured.updated_at)) * 1000)::bigint, 0)
  into v_selection_revision
  from public.game_player_featured_achievements featured
  where featured.nick_key = p_nick_key;

  v_profile_revision := greatest(
    coalesce((v_profile->>'profileRevision')::bigint, 0),
    v_selection_revision
  );

  v_profile := jsonb_set(v_profile, '{achievements}', v_achievements, true);
  return v_profile || jsonb_build_object(
    'honoursProgress', v_progress,
    'profileRevision', v_profile_revision
  );
end;
$$;

revoke all on table public.game_player_featured_achievements from public, anon, authenticated;
grant select, insert, update on table public.game_player_featured_achievements to service_role;

revoke all on function public.get_game_player_featured_achievements(text) from public, anon, authenticated;
revoke all on function public.set_game_player_featured_achievements(text, text[]) from public, anon, authenticated;
revoke all on function public.get_game_player_honours_progress(text) from public, anon, authenticated;
revoke all on function public.get_game_player_profile_before_honours_customization(text) from public, anon, authenticated;
revoke all on function public.get_game_player_profile(text) from public, anon, authenticated;

grant execute on function public.get_game_player_featured_achievements(text) to service_role;
grant execute on function public.set_game_player_featured_achievements(text, text[]) to service_role;
grant execute on function public.get_game_player_honours_progress(text) to service_role;
grant execute on function public.get_game_player_profile_before_honours_customization(text) to service_role;
grant execute on function public.get_game_player_profile(text) to service_role;
