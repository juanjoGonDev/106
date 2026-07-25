create or replace function public.get_game_league(p_code text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
with selected as (
  select league.public_id
  from public.game_leagues league
  where league.public_id = upper(trim(p_code))
     or league.code = upper(trim(p_code))
  order by (league.public_id = upper(trim(p_code))) desc
  limit 1
), public_view as (
  select public.get_game_public_league(selected.public_id) as payload
  from selected
)
select coalesce(
  public_view.payload || jsonb_build_object('code', public_view.payload->>'publicId'),
  '{}'::jsonb
)
from public_view
union all
select '{}'::jsonb
where not exists (select 1 from public_view)
limit 1;
$$;

create or replace function public.get_game_player_profile(p_nick_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile jsonb;
  v_history jsonb;
  v_league_history jsonb;
  v_rank integer;
  v_daily_trophies integer;
  v_league_wins integer;
begin
  perform public.sync_game_trophy_history();
  perform public.sync_game_league_trophies();
  perform public.refresh_game_player_progression_achievements(p_nick_key);

  v_profile := public.get_game_player_profile_before_progression(p_nick_key);
  if not coalesce(v_profile ? 'nick', false) then
    return v_profile;
  end if;

  select coalesce(jsonb_agg(
    case
      when item.value->>'type' = 'league_champion' then
        (item.value - 'leagueCode') || jsonb_build_object(
          'leaguePublicId', league.public_id
        )
      else item.value
    end
    order by item.ordinality
  ), '[]'::jsonb)
  into v_history
  from jsonb_array_elements(coalesce(v_profile #> '{trophies,history}', '[]'::jsonb))
    with ordinality as item(value, ordinality)
  left join public.game_leagues league on league.code = item.value->>'leagueCode';

  select coalesce(jsonb_agg(
    (item.value - 'leagueCode') || jsonb_build_object(
      'leaguePublicId', league.public_id
    )
    order by item.ordinality
  ), '[]'::jsonb)
  into v_league_history
  from jsonb_array_elements(coalesce(v_profile #> '{leagueTrophies,history}', '[]'::jsonb))
    with ordinality as item(value, ordinality)
  left join public.game_leagues league on league.code = item.value->>'leagueCode';

  select public.get_game_global_player_rank(p_nick_key) into v_rank;
  select count(*)::integer into v_daily_trophies
  from public.game_daily_trophies where nick_key = p_nick_key;
  select count(*)::integer into v_league_wins
  from public.game_league_trophies where nick_key = p_nick_key;

  v_profile := jsonb_set(v_profile, '{trophies,history}', v_history, true);
  v_profile := jsonb_set(v_profile, '{leagueTrophies,history}', v_league_history, true);
  v_profile := jsonb_set(
    v_profile,
    '{globalRankBest}',
    coalesce(to_jsonb(v_rank), 'null'::jsonb),
    true
  );

  return v_profile || jsonb_build_object(
    'rankingTieBreak', jsonb_build_object(
      'achievementPoints', coalesce((v_profile #>> '{achievements,points}')::integer, 0),
      'dailyTrophies', coalesce(v_daily_trophies, 0),
      'leagueWins', coalesce(v_league_wins, 0),
      'verifiedAttempts', coalesce((v_profile->>'verifiedAttempts')::integer, 0)
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

revoke all on function public.get_game_league(text) from public, anon, authenticated;
revoke all on function public.get_game_player_profile(text) from public, anon, authenticated;
revoke all on function public.get_game_public_profile(text) from public, anon, authenticated;

grant execute on function public.get_game_league(text) to service_role;
grant execute on function public.get_game_player_profile(text) to service_role;
grant execute on function public.get_game_public_profile(text) to service_role;
