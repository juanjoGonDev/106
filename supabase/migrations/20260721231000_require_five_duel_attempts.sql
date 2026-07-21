create or replace function public.resolve_game_duel(
  p_code uuid,
  p_opponent_nick_key text,
  p_device_hash text,
  p_ip_hash text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_duel public.game_duels%rowtype;
  v_best integer;
  v_attempt_count integer;
  v_won boolean;
begin
  select * into v_duel from public.game_duels where code = p_code for update;
  if not found then return jsonb_build_object('error','duel_not_found'); end if;
  if v_duel.status <> 'open' or v_duel.expires_at < clock_timestamp() then return jsonb_build_object('error','duel_closed'); end if;
  if v_duel.challenger_nick_key = p_opponent_nick_key or v_duel.challenger_device_hash = p_device_hash or v_duel.challenger_ip_hash = p_ip_hash then
    return jsonb_build_object('error','duel_self');
  end if;

  select count(*)::integer, min(difference_ms)::integer into v_attempt_count, v_best
  from public.game_attempts
  where nick_key = p_opponent_nick_key and verified = true and created_at >= v_duel.created_at;

  if v_attempt_count < 5 or v_best is null then
    return jsonb_build_object('error','duel_incomplete','attemptsCompleted',v_attempt_count,'attemptsRequired',5);
  end if;

  v_won := v_best < v_duel.challenger_best_difference_ms;
  update public.game_duels set opponent_nick_key = p_opponent_nick_key, opponent_device_hash = p_device_hash,
    opponent_ip_hash = p_ip_hash, opponent_best_difference_ms = v_best,
    status = case when v_won then 'won' else 'lost' end, completed_at = clock_timestamp(), reward_granted = true
  where id = v_duel.id;

  insert into public.game_player_bonus(nick_key, bonus_attempts, updated_at)
  values (case when v_won then p_opponent_nick_key else v_duel.challenger_nick_key end, case when v_won then 3 else 1 end, clock_timestamp())
  on conflict (nick_key) do update
  set bonus_attempts = public.game_player_bonus.bonus_attempts + excluded.bonus_attempts,
      updated_at = excluded.updated_at;

  return jsonb_build_object(
    'won',v_won,
    'rewardAttempts',case when v_won then 3 else 1 end,
    'challengerBestDifferenceMs',v_duel.challenger_best_difference_ms,
    'opponentBestDifferenceMs',v_best,
    'attemptsCompleted',v_attempt_count
  );
end $$;