revoke all on table public.game_attempt_integrity, public.game_attempt_integrity_events
  from public, anon, authenticated, service_role;

grant select, insert, update, delete on table public.game_attempt_integrity
  to service_role;
grant select, insert on table public.game_attempt_integrity_events
  to service_role;

grant usage, select on sequence public.game_attempt_integrity_events_id_seq
  to service_role;

create or replace function public.reconcile_game_account_referral(p_account_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_account_id uuid := public.daily_game_account_id(p_account_id);
  v_fifth_verified_at timestamptz;
  v_referral public.game_referrals%rowtype;
  v_changed boolean := false;
begin
  if v_account_id is null then
    return false;
  end if;

  -- Share the exact lock namespace with complete_game_account_referral so
  -- an ordinary fifth-attempt completion cannot race a retrospective rollback.
  perform pg_advisory_xact_lock(hashtextextended('referral-complete:' || v_account_id::text, 106));

  select attempt.created_at
  into v_fifth_verified_at
  from public.game_attempts attempt
  join public.game_account_players account_player
    on account_player.nick_key = attempt.nick_key
  where public.daily_game_account_id(account_player.account_id) = v_account_id
    and attempt.league_id is null
    and attempt.verified = true
  order by attempt.created_at, attempt.id
  offset 4
  limit 1;

  select referral.*
  into v_referral
  from public.game_referrals referral
  where referral.reward_eligible = true
    and public.daily_game_account_id(referral.referred_account_id) = v_account_id
  order by referral.created_at, referral.id
  limit 1
  for update;

  if not found then
    return false;
  end if;

  if v_referral.completed_at is distinct from v_fifth_verified_at then
    update public.game_referrals
    set completed_at = v_fifth_verified_at
    where id = v_referral.id;
    v_changed := true;
  end if;

  if v_changed
     and coalesce(current_setting('minuto106.integrity_bulk', true), '') <> 'on' then
    perform public.rebuild_game_player_achievements(v_referral.referrer_nick_key);
    perform public.rebuild_game_player_achievements(v_referral.referred_nick_key);
  end if;

  return v_changed;
end;
$$;

revoke all on function public.reconcile_game_account_referral(uuid)
  from public, anon, authenticated;
grant execute on function public.reconcile_game_account_referral(uuid)
  to service_role;

comment on table public.game_attempt_integrity_events is
  'Append-only service-role audit ledger for integrity decisions. UPDATE and DELETE are intentionally not granted; raw game attempts remain the evidence source.';
comment on function public.reconcile_game_account_referral(uuid) is
  'Recomputes referral completion from the current fifth verified global attempt under the same advisory lock as normal completion.';
