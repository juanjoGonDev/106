create or replace function public.get_game_league_status(p_league_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.get_game_league_activation_state(league.id) || jsonb_build_object(
    'active', league.activated_at is not null and league.ends_at > clock_timestamp(),
    'waiting', league.activated_at is null,
    'finished', league.activated_at is not null and league.ends_at <= clock_timestamp(),
    'activatedAt', league.activated_at,
    'startsAt', case when league.activated_at is null then null else league.starts_at end,
    'endsAt', case when league.activated_at is null then null else league.ends_at end
  )
  from public.game_leagues league
  where league.id = p_league_id;
$$;

create or replace function public.get_game_league(p_code text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
with selected_league as (
  select league.*
  from public.game_leagues league
  where league.code = upper(trim(p_code))
), member_stats as (
  select member.nick_key, player.nick, member.joined_at,
    count(attempt.id)::integer as attempts_used,
    count(attempt.id) filter (where attempt.verified = true)::integer as verified_attempts,
    min(attempt.difference_ms) filter (where attempt.verified = true)::integer as best_difference_ms
  from selected_league league
  join public.game_league_members member on member.league_id = league.id
  join public.game_players player on player.nick_key = member.nick_key
  left join public.game_attempts attempt on attempt.league_id = league.id and attempt.nick_key = member.nick_key
  group by member.nick_key, player.nick, member.joined_at
), ranked as (
  select *, case when best_difference_ms is null then null else
    dense_rank() over(order by best_difference_ms, joined_at, nick_key)::integer end as rank
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
    'code', league.code,
    'name', league.name,
    'createdAt', league.created_at,
    'members', (select count(*)::integer from ranked),
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

create or replace function public.get_game_league_player_status(
  p_code text,
  p_nick_key text
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_league public.game_leagues%rowtype;
  v_attempts integer;
  v_verified integer;
  v_best integer;
  v_rank integer;
  v_history jsonb;
begin
  select * into v_league from public.game_leagues where code = upper(trim(p_code));
  if not found then return jsonb_build_object('error', 'league_not_found'); end if;
  if not exists (
    select 1 from public.game_league_members where league_id = v_league.id and nick_key = p_nick_key
  ) then
    return jsonb_build_object('error', 'league_membership_required');
  end if;

  select count(*)::integer,
    count(*) filter (where verified = true)::integer,
    min(difference_ms) filter (where verified = true)::integer
  into v_attempts, v_verified, v_best
  from public.game_attempts
  where league_id = v_league.id and nick_key = p_nick_key;

  with member_best as (
    select member.nick_key, member.joined_at,
      min(attempt.difference_ms) filter (where attempt.verified = true)::integer as best_difference_ms
    from public.game_league_members member
    left join public.game_attempts attempt
      on attempt.league_id = member.league_id and attempt.nick_key = member.nick_key
    where member.league_id = v_league.id
    group by member.nick_key, member.joined_at
  ), ranked as (
    select nick_key, case when best_difference_ms is null then null else
      dense_rank() over(order by best_difference_ms, joined_at, nick_key)::integer end as rank
    from member_best
  )
  select rank into v_rank from ranked where nick_key = p_nick_key;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', history.id,
    'team', history.team,
    'elapsedMs', history.client_elapsed_ms,
    'differenceMs', history.difference_ms,
    'verified', history.verified,
    'createdAt', history.created_at
  ) order by history.created_at desc), '[]'::jsonb)
  into v_history
  from (
    select * from public.game_attempts
    where league_id = v_league.id and nick_key = p_nick_key
    order by created_at desc limit 10
  ) history;

  return jsonb_build_object(
    'member', true,
    'code', v_league.code,
    'name', v_league.name,
    'attemptsUsed', v_attempts,
    'attemptsLeft', greatest(0, 5 - v_attempts),
    'maxAttempts', 5,
    'verifiedAttempts', v_verified,
    'bestDifferenceMs', v_best,
    'rank', v_rank,
    'history', v_history
  ) || public.get_game_league_status(v_league.id);
end;
$$;

create or replace function public.get_game_player_leagues(p_nick_key text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
with memberships as (
  select league.*, owner.nick as owner_nick
  from public.game_league_members mine
  join public.game_leagues league on league.id = mine.league_id
  join public.game_players owner on owner.nick_key = league.owner_nick_key
  where mine.nick_key = p_nick_key
), member_best as (
  select member.league_id, member.nick_key, member.joined_at,
    min(attempt.difference_ms) filter (where attempt.verified = true)::integer as best_difference_ms
  from public.game_league_members member
  join memberships league on league.id = member.league_id
  left join public.game_attempts attempt
    on attempt.league_id = member.league_id and attempt.nick_key = member.nick_key
  group by member.league_id, member.nick_key, member.joined_at
), ranked as (
  select league_id, nick_key, case when best_difference_ms is null then null else
    dense_rank() over(partition by league_id order by best_difference_ms, joined_at, nick_key)::integer end as rank
  from member_best
), summaries as (
  select league.id,
    count(attempt.id)::integer as attempts_used,
    count(attempt.id) filter (where attempt.verified = true)::integer as verified_attempts,
    min(attempt.difference_ms) filter (where attempt.verified = true)::integer as best_difference_ms
  from memberships league
  left join public.game_attempts attempt on attempt.league_id = league.id and attempt.nick_key = p_nick_key
  group by league.id
)
select coalesce(jsonb_agg(
  jsonb_build_object(
    'code', league.code,
    'name', league.name,
    'ownerNick', league.owner_nick,
    'isOwner', league.owner_nick_key = p_nick_key,
    'createdAt', league.created_at,
    'members', (select count(*)::integer from public.game_league_members member where member.league_id = league.id),
    'attemptsUsed', summary.attempts_used,
    'attemptsLeft', greatest(0, 5 - summary.attempts_used),
    'maxAttempts', 5,
    'verifiedAttempts', summary.verified_attempts,
    'bestDifferenceMs', summary.best_difference_ms,
    'rank', ranked.rank,
    'revision', floor(extract(epoch from coalesce((
      select max(changed_at)
      from (
        select league.created_at as changed_at
        union all select league.activated_at where league.activated_at is not null
        union all select member.joined_at from public.game_league_members member where member.league_id = league.id
        union all select attempt.created_at from public.game_attempts attempt where attempt.league_id = league.id
        union all select trophy.awarded_at from public.game_league_trophies trophy where trophy.league_id = league.id
      ) changes
    ), league.created_at)) * 1000)::bigint,
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', history.id,
        'team', history.team,
        'elapsedMs', history.client_elapsed_ms,
        'differenceMs', history.difference_ms,
        'verified', history.verified,
        'createdAt', history.created_at
      ) order by history.created_at desc)
      from (
        select * from public.game_attempts
        where league_id = league.id and nick_key = p_nick_key
        order by created_at desc limit 10
      ) history
    ), '[]'::jsonb)
  ) || public.get_game_league_status(league.id)
  order by (league.activated_at is null) desc,
    (league.activated_at is not null and league.ends_at > clock_timestamp()) desc,
    league.created_at desc
), '[]'::jsonb)
from memberships league
join summaries summary on summary.id = league.id
left join ranked on ranked.league_id = league.id and ranked.nick_key = p_nick_key;
$$;

revoke all on function public.get_game_league_status(uuid) from public, anon, authenticated;
revoke all on function public.get_game_league(text) from public, anon, authenticated;
revoke all on function public.get_game_league_player_status(text, text) from public, anon, authenticated;
revoke all on function public.get_game_player_leagues(text) from public, anon, authenticated;

grant execute on function public.get_game_league_status(uuid) to service_role;
grant execute on function public.get_game_league(text) to service_role;
grant execute on function public.get_game_league_player_status(text, text) to service_role;
grant execute on function public.get_game_player_leagues(text) to service_role;
