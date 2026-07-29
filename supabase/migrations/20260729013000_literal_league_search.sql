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
        or strpos(lower(league.name), v_search) > 0
        or strpos(lower(league.public_id), v_search) > 0
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

revoke all on function public.list_game_leagues(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.list_game_leagues(text, text, integer, integer) to service_role;
