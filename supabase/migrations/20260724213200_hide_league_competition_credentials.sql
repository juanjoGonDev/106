create or replace function public.get_game_player_league_competition_code(
  p_public_id text,
  p_nick_key text
) returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select league.code
  from public.game_leagues league
  join public.game_league_members member on member.league_id = league.id
  where league.public_id = upper(trim(p_public_id))
    and member.nick_key = p_nick_key
    and league.activated_at is not null
    and league.ends_at > clock_timestamp();
$$;

create or replace function public.get_game_league_player_status_by_public_id(
  p_public_id text,
  p_nick_key text
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_code text;
begin
  select league.code into v_code
  from public.game_leagues league
  join public.game_league_members member on member.league_id = league.id
  where league.public_id = upper(trim(p_public_id))
    and member.nick_key = p_nick_key;

  if v_code is null then
    return jsonb_build_object('error', 'league_membership_required');
  end if;

  return public.get_game_league_player_status(v_code, p_nick_key);
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
    min(attempt.difference_ms) filter (where attempt.verified = true)::integer as best_difference_ms,
    min(attempt.created_at) filter (where attempt.verified = true)::timestamptz as best_at
  from public.game_league_members member
  join memberships league on league.id = member.league_id
  left join public.game_attempts attempt
    on attempt.league_id = member.league_id and attempt.nick_key = member.nick_key
  group by member.league_id, member.nick_key, member.joined_at
), ranked as (
  select league_id, nick_key, case when best_difference_ms is null then null else
    row_number() over(partition by league_id order by best_difference_ms, best_at, joined_at, nick_key)::integer end as rank
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
    'publicId', league.public_id,
    'joinCode', case when league.owner_nick_key = p_nick_key then league.code else null end,
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

revoke all on function public.get_game_player_league_competition_code(text, text) from public, anon, authenticated;
revoke all on function public.get_game_league_player_status_by_public_id(text, text) from public, anon, authenticated;
revoke all on function public.get_game_player_leagues(text) from public, anon, authenticated;

grant execute on function public.get_game_player_league_competition_code(text, text) to service_role;
grant execute on function public.get_game_league_player_status_by_public_id(text, text) to service_role;
grant execute on function public.get_game_player_leagues(text) to service_role;
