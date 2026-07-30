create or replace function public.get_game_account_daily_attempt_policy(
  p_account_id uuid,
  p_at timestamptz default clock_timestamp()
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_day date := public.game_server_day(p_at);
  v_account_id uuid := public.daily_game_account_id(p_account_id);
  v_referral_bonus integer := 0;
  v_auth_bonus integer := 0;
  v_bonus integer := 0;
  v_completed_referrals integer := 0;
begin
  if v_account_id is not null then
    v_referral_bonus := public.game_account_referral_bonus(v_account_id);
    v_auth_bonus := public.game_account_auth_daily_bonus(v_account_id);
    v_completed_referrals := public.game_account_completed_referrals(v_account_id);
  end if;

  v_bonus := least(5, greatest(0, v_referral_bonus) + greatest(0, v_auth_bonus));

  return jsonb_build_object(
    'attemptsUsed', 0,
    'dailyAttemptsUsed', 0,
    'dailyAttemptsReserved', 0,
    'attemptsLeft', 5 + v_bonus,
    'maxAttempts', 5 + v_bonus,
    'bonusAttempts', v_bonus,
    'authRewardBonus', v_auth_bonus,
    'emailVerificationBonus', v_auth_bonus,
    'completedReferrals', v_completed_referrals,
    'dailyLimitBase', 5,
    'dailyLimitCeiling', 10,
    'dailyQuotaDay', v_day,
    'dailyResetAt', public.game_server_reset_at(v_day)
  );
end;
$$;

create or replace function public.get_game_auth_daily_attempt_policy(
  p_auth_user_id uuid,
  p_at timestamptz default clock_timestamp()
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_account_id uuid;
begin
  select identity.account_id into v_account_id
  from public.game_auth_identities identity
  where identity.auth_user_id = p_auth_user_id;

  return public.get_game_account_daily_attempt_policy(v_account_id, p_at);
end;
$$;

create or replace function public.game_player_daily_bonus(p_nick_key text)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with selected as (
    select public.game_account_id_for_nick(p_nick_key) as account_id
  ), legacy as (
    select coalesce(bonus.bonus_attempts, 0)::integer as total_bonus,
      (
        select count(*)::integer
        from public.game_referrals referral
        where referral.referrer_nick_key = p_nick_key
          and referral.completed_at is not null
      ) as historical_referral_bonus
    from (select 1) seed
    left join public.game_player_bonus bonus on bonus.nick_key = p_nick_key
  ), account_policy as (
    select coalesce(
      (public.get_game_account_daily_attempt_policy(selected.account_id)->>'bonusAttempts')::integer,
      0
    ) as account_bonus
    from selected
  )
  select least(
    5,
    account_policy.account_bonus
      + greatest(0, legacy.total_bonus - legacy.historical_referral_bonus)
  )::integer
  from account_policy cross join legacy;
$$;

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
  v_policy jsonb := public.get_game_account_daily_attempt_policy(v_account_id, p_at);
  v_bonus integer := public.game_player_daily_bonus(p_nick_key);
  v_base integer := coalesce((v_policy->>'dailyLimitBase')::integer, 5);
  v_max_attempts integer := v_base + v_bonus;
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
    'authRewardBonus', coalesce((v_policy->>'authRewardBonus')::integer, 0),
    'emailVerificationBonus', coalesce((v_policy->>'emailVerificationBonus')::integer, 0),
    'completedReferrals', coalesce((v_policy->>'completedReferrals')::integer, 0),
    'dailyLimitBase', v_base,
    'dailyLimitCeiling', coalesce((v_policy->>'dailyLimitCeiling')::integer, 10),
    'dailyQuotaDay', v_day,
    'dailyResetAt', v_policy->>'dailyResetAt'
  );
end;
$$;

revoke all on function public.get_game_account_daily_attempt_policy(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.get_game_auth_daily_attempt_policy(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.game_player_daily_bonus(text) from public, anon, authenticated;
revoke all on function public.get_game_daily_attempt_state(text, timestamptz) from public, anon, authenticated;

grant execute on function public.get_game_account_daily_attempt_policy(uuid, timestamptz) to service_role;
grant execute on function public.get_game_auth_daily_attempt_policy(uuid, timestamptz) to service_role;
grant execute on function public.game_player_daily_bonus(text) to service_role;
grant execute on function public.get_game_daily_attempt_state(text, timestamptz) to service_role;
