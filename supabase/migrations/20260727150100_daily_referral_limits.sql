create or replace function public.get_game_daily_attempt_state(
  p_nick_key text,
  p_at timestamptz default clock_timestamp()
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_day date := public.game_server_day(p_at);
  v_account_id uuid := public.game_account_id_for_nick(p_nick_key);
  v_bonus integer := public.game_player_daily_bonus(p_nick_key);
  v_completed_referrals integer := public.game_account_completed_referrals(v_account_id);
  v_max_attempts integer := 5 + v_bonus;
  v_attempts_used integer := 0;
  v_attempts_reserved integer := 0;
begin
  select count(*)::integer into v_attempts_used
  from public.game_attempts attempt
  where attempt.nick_key = p_nick_key
    and attempt.league_id is null
    and attempt.quota_day = v_day;

  select count(*)::integer into v_attempts_reserved
  from public.game_challenges challenge
  where challenge.nick_key = p_nick_key
    and challenge.league_id is null
    and challenge.quota_day = v_day
    and challenge.consumed_at is null
    and challenge.expires_at > p_at;

  return jsonb_build_object(
    'attemptsUsed', v_attempts_used,
    'dailyAttemptsUsed', v_attempts_used,
    'dailyAttemptsReserved', v_attempts_reserved,
    'attemptsLeft', greatest(0, v_max_attempts - v_attempts_used - v_attempts_reserved),
    'maxAttempts', v_max_attempts,
    'bonusAttempts', v_bonus,
    'completedReferrals', v_completed_referrals,
    'dailyLimitBase', 5,
    'dailyLimitCeiling', 10,
    'dailyQuotaDay', v_day,
    'dailyResetAt', public.game_server_reset_at(v_day)
  );
end;
$$;

create or replace function public.register_game_account_referral(
  p_referral_code uuid,
  p_referred_nick_key text,
  p_device_hash text,
  p_ip_hash text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_referrer public.game_players%rowtype;
  v_referrer_account_id uuid;
  v_referred_account_id uuid := public.game_account_id_for_nick(p_referred_nick_key);
  v_referral_id uuid;
begin
  if p_referral_code is null or v_referred_account_id is null then
    return jsonb_build_object('registered', false, 'reason', 'account_missing');
  end if;

  select player.* into v_referrer
  from public.game_players player
  where player.referral_code = p_referral_code;

  if not found then
    return jsonb_build_object('registered', false, 'reason', 'referrer_missing');
  end if;

  v_referrer_account_id := public.game_account_id_for_nick(v_referrer.nick_key);
  if v_referrer_account_id is null then
    return jsonb_build_object('registered', false, 'reason', 'referrer_missing');
  end if;
  if v_referrer_account_id = v_referred_account_id then
    return jsonb_build_object('registered', false, 'reason', 'same_account');
  end if;
  if v_referrer.first_device_hash = p_device_hash then
    return jsonb_build_object('registered', false, 'reason', 'same_device');
  end if;
  if v_referrer.first_ip_hash = p_ip_hash then
    return jsonb_build_object('registered', false, 'reason', 'same_ip');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('referral-account:' || v_referred_account_id::text, 106));

  if exists (
    select 1
    from public.game_referrals referral
    where referral.reward_eligible = true
      and public.daily_game_account_id(referral.referred_account_id) = v_referred_account_id
  ) then
    return jsonb_build_object('registered', false, 'reason', 'account_already_referred');
  end if;

  insert into public.game_referrals(
    referral_code,
    referrer_nick_key,
    referred_nick_key,
    referred_device_hash,
    referred_ip_hash,
    referrer_account_id,
    referred_account_id,
    reward_eligible,
    ineligible_reason
  ) values (
    p_referral_code,
    v_referrer.nick_key,
    p_referred_nick_key,
    p_device_hash,
    p_ip_hash,
    v_referrer_account_id,
    v_referred_account_id,
    true,
    null
  )
  on conflict (referred_nick_key) do update
    set referral_code = excluded.referral_code,
        referrer_nick_key = excluded.referrer_nick_key,
        referred_device_hash = excluded.referred_device_hash,
        referred_ip_hash = excluded.referred_ip_hash,
        referrer_account_id = excluded.referrer_account_id,
        referred_account_id = excluded.referred_account_id,
        reward_eligible = true,
        ineligible_reason = null
    where public.game_referrals.reward_eligible = false
      and public.game_referrals.completed_at is null
  returning id into v_referral_id;

  if v_referral_id is null then
    return jsonb_build_object('registered', false, 'reason', 'account_already_referred');
  end if;

  return jsonb_build_object('registered', true, 'referralId', v_referral_id);
exception
  when unique_violation then
    return jsonb_build_object('registered', false, 'reason', 'account_already_referred');
end;
$$;

create or replace function public.complete_game_account_referral(
  p_referred_account_id uuid,
  p_completed_at timestamptz default clock_timestamp()
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_referred_account_id uuid := public.daily_game_account_id(p_referred_account_id);
  v_referral public.game_referrals%rowtype;
  v_verified_attempts integer := 0;
  v_referrer_account_id uuid;
  v_bonus integer := 0;
begin
  if v_referred_account_id is null then
    return jsonb_build_object('completed', false, 'reason', 'account_missing');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('referral-complete:' || v_referred_account_id::text, 106));

  select count(*)::integer into v_verified_attempts
  from public.game_attempts attempt
  join public.game_account_players account_player on account_player.nick_key = attempt.nick_key
  where public.daily_game_account_id(account_player.account_id) = v_referred_account_id
    and attempt.league_id is null
    and attempt.verified = true;

  if v_verified_attempts < 5 then
    return jsonb_build_object(
      'completed', false,
      'reason', 'insufficient_verified_attempts',
      'verifiedAttempts', v_verified_attempts
    );
  end if;

  select referral.* into v_referral
  from public.game_referrals referral
  where referral.reward_eligible = true
    and referral.completed_at is null
    and public.daily_game_account_id(referral.referred_account_id) = v_referred_account_id
    and public.daily_game_account_id(referral.referrer_account_id) <> v_referred_account_id
  order by referral.created_at, referral.id
  limit 1
  for update;

  if not found then
    return jsonb_build_object('completed', false, 'reason', 'no_pending_referral');
  end if;

  update public.game_referrals
  set completed_at = p_completed_at
  where id = v_referral.id
    and completed_at is null;

  v_referrer_account_id := public.daily_game_account_id(v_referral.referrer_account_id);
  v_bonus := public.game_account_referral_bonus(v_referrer_account_id);

  return jsonb_build_object(
    'completed', true,
    'referralId', v_referral.id,
    'referrerAccountId', v_referrer_account_id,
    'bonusAttempts', v_bonus
  );
end;
$$;
