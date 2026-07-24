alter table public.game_duels
  add column if not exists challenger_attempt_id uuid references public.game_attempts(id) on delete restrict,
  add column if not exists challenger_elapsed_ms integer check (challenger_elapsed_ms between 500 and 30000);

with selected_attempts as (
  select duel.id as duel_id,
    attempt.id as attempt_id,
    attempt.client_elapsed_ms
  from public.game_duels duel
  join lateral (
    select candidate.id, candidate.client_elapsed_ms
    from public.game_attempts candidate
    where candidate.nick_key = duel.challenger_nick_key
      and candidate.verified = true
      and candidate.league_id is null
      and candidate.difference_ms = duel.challenger_best_difference_ms
      and candidate.created_at <= duel.created_at
    order by candidate.created_at, candidate.id
    limit 1
  ) attempt on true
  where duel.challenger_attempt_id is null or duel.challenger_elapsed_ms is null
)
update public.game_duels duel
set challenger_attempt_id = selected.attempt_id,
    challenger_elapsed_ms = selected.client_elapsed_ms
from selected_attempts selected
where duel.id = selected.duel_id;

create index if not exists game_duels_challenger_attempt_idx
  on public.game_duels(challenger_attempt_id);

create or replace function public.create_game_duel(
  p_nick_key text,
  p_device_hash text,
  p_ip_hash text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempt public.game_attempts%rowtype;
  v_code uuid;
  v_expires_at timestamptz;
begin
  select * into v_attempt
  from public.game_attempts attempt
  where attempt.nick_key = p_nick_key
    and attempt.verified = true
    and attempt.league_id is null
  order by attempt.difference_ms, attempt.created_at, attempt.id
  limit 1;

  if not found then
    return jsonb_build_object('error', 'no_verified_attempt');
  end if;

  if (
    select count(*)
    from public.game_duels duel
    where duel.challenger_nick_key = p_nick_key
      and duel.created_at > clock_timestamp() - interval '1 day'
  ) >= 10 then
    return jsonb_build_object('error', 'duel_daily_limit');
  end if;

  insert into public.game_duels(
    challenger_nick_key,
    challenger_best_difference_ms,
    challenger_attempt_id,
    challenger_elapsed_ms,
    challenger_device_hash,
    challenger_ip_hash
  ) values (
    p_nick_key,
    v_attempt.difference_ms,
    v_attempt.id,
    v_attempt.client_elapsed_ms,
    p_device_hash,
    p_ip_hash
  )
  returning code, expires_at into v_code, v_expires_at;

  return jsonb_build_object(
    'code', v_code,
    'targetAttemptId', v_attempt.id,
    'targetElapsedMs', v_attempt.client_elapsed_ms,
    'targetDifferenceMs', v_attempt.difference_ms,
    'expiresAt', v_expires_at
  );
end;
$$;

create or replace function public.get_game_public_duel(p_code uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select jsonb_build_object(
      'code', duel.code,
      'challengerNick', challenger.nick,
      'challengerTeam', target_attempt.team,
      'targetAttemptId', coalesce(duel.challenger_attempt_id, target_attempt.id),
      'targetElapsedMs', coalesce(duel.challenger_elapsed_ms, target_attempt.client_elapsed_ms),
      'targetDifferenceMs', duel.challenger_best_difference_ms,
      'status', case
        when duel.status = 'open' and duel.expires_at <= clock_timestamp() then 'expired'
        else duel.status
      end,
      'open', duel.status = 'open' and duel.expires_at > clock_timestamp(),
      'createdAt', duel.created_at,
      'expiresAt', duel.expires_at,
      'completedAt', duel.completed_at,
      'opponentNick', opponent.nick,
      'opponentBestDifferenceMs', duel.opponent_best_difference_ms,
      'revision', floor(extract(epoch from greatest(duel.created_at, coalesce(duel.completed_at, duel.created_at))) * 1000)::bigint
    )
    from public.game_duels duel
    join public.game_players challenger on challenger.nick_key = duel.challenger_nick_key
    left join public.game_attempts target_attempt on target_attempt.id = duel.challenger_attempt_id
    left join public.game_players opponent on opponent.nick_key = duel.opponent_nick_key
    where duel.code = p_code
  ), '{}'::jsonb);
$$;

create or replace function public.get_game_public_attempt(p_attempt_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select jsonb_build_object(
      'id', attempt.id,
      'nick', attempt.nick,
      'team', attempt.team,
      'elapsedMs', attempt.client_elapsed_ms,
      'differenceMs', attempt.difference_ms,
      'verified', attempt.verified,
      'createdAt', attempt.created_at,
      'competitionType', case when attempt.league_id is null then 'global' else 'league' end,
      'leagueCode', league.code,
      'leagueName', league.name,
      'revision', floor(extract(epoch from attempt.created_at) * 1000)::bigint
    )
    from public.game_attempts attempt
    left join public.game_leagues league on league.id = attempt.league_id
    where attempt.id = p_attempt_id
  ), '{}'::jsonb);
$$;

create or replace function public.get_game_public_referral(p_referral_code uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select jsonb_build_object(
      'referralCode', player.referral_code,
      'nick', player.nick,
      'nickKey', player.nick_key,
      'team', latest.team,
      'bestDifferenceMs', (
        select min(attempt.difference_ms)::integer
        from public.game_attempts attempt
        where attempt.nick_key = player.nick_key
          and attempt.verified = true
          and attempt.league_id is null
      ),
      'profileRevision', public.get_game_profile_revision(player.nick_key)
    )
    from public.game_players player
    left join lateral (
      select attempt.team
      from public.game_attempts attempt
      where attempt.nick_key = player.nick_key
        and attempt.verified = true
        and attempt.league_id is null
      order by attempt.created_at desc, attempt.id desc
      limit 1
    ) latest on true
    where player.referral_code = p_referral_code
  ), '{}'::jsonb);
$$;

revoke all on function public.create_game_duel(text, text, text) from public, anon, authenticated;
revoke all on function public.get_game_public_duel(uuid) from public, anon, authenticated;
revoke all on function public.get_game_public_attempt(uuid) from public, anon, authenticated;
revoke all on function public.get_game_public_referral(uuid) from public, anon, authenticated;

grant execute on function public.create_game_duel(text, text, text) to service_role;
grant execute on function public.get_game_public_duel(uuid) to service_role;
grant execute on function public.get_game_public_attempt(uuid) to service_role;
grant execute on function public.get_game_public_referral(uuid) to service_role;
