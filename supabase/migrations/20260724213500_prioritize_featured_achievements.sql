alter function public.get_game_player_profile(text)
  rename to get_game_player_profile_before_featured_order;

create or replace function public.get_game_player_profile(p_nick_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile jsonb;
  v_items jsonb;
begin
  v_profile := public.get_game_player_profile_before_featured_order(p_nick_key);
  if not coalesce(v_profile ? 'nick', false) then
    return v_profile;
  end if;

  select coalesce(jsonb_agg(item.value order by
    coalesce((featured.value->>'position')::integer, 2147483647),
    case when featured.value is null then 1 else 0 end,
    item.ordinality
  ), '[]'::jsonb)
  into v_items
  from jsonb_array_elements(coalesce(v_profile #> '{achievements,items}', '[]'::jsonb))
    with ordinality as item(value, ordinality)
  left join jsonb_array_elements(coalesce(v_profile #> '{achievements,featured}', '[]'::jsonb))
    as featured(value)
    on featured.value->>'code' = item.value->>'code';

  return jsonb_set(v_profile, '{achievements,items}', v_items, true);
end;
$$;

revoke all on function public.get_game_player_profile_before_featured_order(text) from public, anon, authenticated;
revoke all on function public.get_game_player_profile(text) from public, anon, authenticated;
grant execute on function public.get_game_player_profile_before_featured_order(text) to service_role;
grant execute on function public.get_game_player_profile(text) to service_role;
