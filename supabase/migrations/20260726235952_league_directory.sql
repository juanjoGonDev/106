create or replace function public.list_game_leagues(
  p_search text,
  p_visibility text,
  p_limit integer,
  p_offset integer
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_search text := left(lower(trim(coalesce(p_search, ''))), 80);
  v_visibility text := lower(trim(coalesce(p_visibility, 'all')));
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_result jsonb;
begin
  if v_visibility not in ('all', 'public', 'private') then
    return jsonb_build_object('error', 'invalid_league_filter');
  end if;

  with selected as (
    select league.*,
      owner.nick as owner_nick,
      (select count(*)::integer from public.game_league_members member where member.league_id = league.id) as participant_count,
      (select count(*)::integer from public.game_attempts attempt where attempt.league_id = league.id) as total_attempts
    from public.game_leagues league
    join public.game_players owner on owner.nick_key = league.owner_nick_key
    where (v_visibility = 'all' or league.visibility = v_visibility)
      and (
        v_search = ''
        or lower(league.name) like '%' || v_search || '%'
        or lower(league.public_id) like '%' || v_search || '%'
      )
    order by
      (league.activated_at is not null and league.starts_at <= clock_timestamp() and league.ends_at > clock_timestamp()) desc,
      (league.activated_at is not null and league.starts_at > clock_timestamp()) desc,
      (league.activated_at is null) desc,
      league.created_at desc,
      league.id
    limit v_limit offset v_offset
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'publicId', league.public_id,
      'name', league.name,
      'ownerNick', league.owner_nick,
      'createdAt', league.created_at,
      'participantCount', league.participant_count,
      'members', league.participant_count,
      'totalAttempts', league.total_attempts,
      'canJoin', league.visibility = 'public'
        and league.participant_count < league.max_participants
        and not (league.activated_at is not null and league.ends_at <= clock_timestamp())
    ) || public.get_game_league_status(league.id)
    order by
      (league.activated_at is not null and league.starts_at <= clock_timestamp() and league.ends_at > clock_timestamp()) desc,
      (league.activated_at is not null and league.starts_at > clock_timestamp()) desc,
      (league.activated_at is null) desc,
      league.created_at desc,
      league.id
  ), '[]'::jsonb)
  into v_result
  from selected league;

  return v_result;
end;
$$;

create or replace function public.get_game_public_league(p_public_id text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
with selected_league as (
  select league.*
  from public.game_leagues league
  where league.public_id = upper(trim(p_public_id))
), member_stats as (
  select member.nick_key, player.nick, member.joined_at,
    count(attempt.id)::integer as attempts_used,
    count(attempt.id) filter (where attempt.verified = true)::integer as verified_attempts,
    min(attempt.difference_ms) filter (where attempt.verified = true)::integer as best_difference_ms,
    min(attempt.created_at) filter (where attempt.verified = true)::timestamptz as best_at
  from selected_league league
  join public.game_league_members member on member.league_id = league.id
  join public.game_players player on player.nick_key = member.nick_key
  left join public.game_attempts attempt on attempt.league_id = league.id and attempt.nick_key = member.nick_key
  group by member.nick_key, player.nick, member.joined_at
), ranked as (
  select *, case when best_difference_ms is null then null else
    row_number() over(order by best_difference_ms, best_at, joined_at, nick_key)::integer end as rank
  from member_stats
), revision as (
  select max(changed_at) as changed_at
  from (
    select league.created_at as changed_at from selected_league league
    union all select league.activated_at from selected_league league where league.activated_at is not null
    union all select member.joined_at from selected_league league join public.game_league_members member on member.league_id = league.id
    union all select attempt.created_at from selected_league league join public.game_attempts attempt on attempt.league_id = league.id
    union all select trophy.awarded_at from selected_league league join public.game_league_trophies trophy on trophy.league_id = league.id
  ) changes
)
select coalesce((
  select jsonb_build_object(
    'publicId', league.public_id,
    'name', league.name,
    'createdAt', league.created_at,
    'members', (select count(*)::integer from ranked),
    'participantCount', (select count(*)::integer from ranked),
    'totalAttempts', (select coalesce(sum(attempts_used), 0)::integer from ranked),
    'revision', floor(extract(epoch from revision.changed_at) * 1000)::bigint,
    'champion', (
      select jsonb_build_object(
        'nick', player.nick,
        'bestDifferenceMs', trophy.best_difference_ms,
        'awardedAt', trophy.awarded_at
      )
      from public.game_league_trophies trophy
      join public.game_players player on player.nick_key = trophy.nick_key
      where trophy.league_id = league.id
    ),
    'leaderboard', coalesce((
      select jsonb_agg(jsonb_build_object(
        'nick', nick,
        'rank', rank,
        'bestDifferenceMs', best_difference_ms,
        'attemptsUsed', attempts_used,
        'verifiedAttempts', verified_attempts
      ) order by rank nulls last, joined_at, nick)
      from ranked
    ), '[]'::jsonb)
  ) || public.get_game_league_status(league.id)
  from selected_league league
  cross join revision
), '{}'::jsonb);
$$;
