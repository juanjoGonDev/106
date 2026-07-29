-- Keep linked-player account summaries independent from historical migration order.
-- Lifetime profile metrics remain available, while quota fields always come from
-- the authoritative current server-day calculation.

create or replace function public.get_game_account_players(p_account_token_hash text)
returns jsonb
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  with selected_account as (
    select public.resolve_game_account_token(p_account_token_hash) as id
  ), attempt_summary as (
    select
      attempt.nick_key,
      count(*)::integer as attempts_used,
      count(*) filter (where attempt.verified)::integer as verified_attempts,
      min(attempt.difference_ms) filter (where attempt.verified)::integer as best_difference_ms,
      round(avg(attempt.difference_ms) filter (where attempt.verified))::integer as average_difference_ms,
      (array_agg(attempt.team order by attempt.created_at desc))[1] as team
    from public.game_attempts attempt
    join public.game_account_players account_player
      on account_player.nick_key = attempt.nick_key
    join selected_account selected
      on selected.id = account_player.account_id
    where selected.id is not null
    group by attempt.nick_key
  ), player_rows as (
    select
      account_player.linked_at,
      jsonb_build_object(
        'nick', player.nick,
        'nickKey', player.nick_key,
        'team', summary.team,
        'lifetimeAttemptsUsed', coalesce(summary.attempts_used, 0),
        'verifiedAttempts', coalesce(summary.verified_attempts, 0),
        'bestDifferenceMs', summary.best_difference_ms,
        'averageDifferenceMs', summary.average_difference_ms,
        'linkedAt', account_player.linked_at
      ) || public.get_game_daily_attempt_state(
        player.nick_key,
        clock_timestamp()
      ) as payload
    from selected_account selected
    join public.game_account_players account_player
      on account_player.account_id = selected.id
    join public.game_players player
      on player.nick_key = account_player.nick_key
    left join attempt_summary summary
      on summary.nick_key = player.nick_key
    where selected.id is not null
  )
  select jsonb_build_object(
    'exists', exists(
      select 1
      from selected_account
      where id is not null
    ),
    'players', coalesce(
      (
        select jsonb_agg(payload order by linked_at desc)
        from player_rows
      ),
      '[]'::jsonb
    )
  );
$$;

revoke all on function public.get_game_account_players(text)
  from public, anon, authenticated;
grant execute on function public.get_game_account_players(text)
  to service_role;
