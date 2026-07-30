-- Preserve lifetime profile aggregates when current-day quota fields are overlaid.
-- `attemptsUsed` remains the authoritative current server-day usage, while
-- `lifetimeAttemptsUsed` shares the same historical scope as `verifiedAttempts`.

create or replace function public.get_game_player_profile(p_nick_key text)
returns jsonb
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  with base_profile as (
    select coalesce(
      public.get_game_player_profile_without_daily_limits(p_nick_key),
      '{}'::jsonb
    ) as payload
  )
  select payload
    || jsonb_build_object(
      'lifetimeAttemptsUsed',
      greatest(0, coalesce(nullif(payload->>'attemptsUsed', '')::integer, 0))
    )
    || public.get_game_daily_attempt_state(
      p_nick_key,
      clock_timestamp()
    )
  from base_profile;
$$;

revoke all on function public.get_game_player_profile(text)
  from public, anon, authenticated;
grant execute on function public.get_game_player_profile(text)
  to service_role;

comment on function public.get_game_player_profile(text) is
  'Returns lifetime global profile aggregates plus authoritative current Europe/Madrid server-day quota fields.';
