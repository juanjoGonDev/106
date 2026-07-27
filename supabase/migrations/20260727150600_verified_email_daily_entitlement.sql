create table if not exists public.game_account_entitlements (
  account_id uuid not null references public.game_accounts(id) on delete cascade,
  entitlement_code text not null,
  granted_at timestamptz not null default clock_timestamp(),
  auth_user_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  primary key (account_id, entitlement_code)
);

alter table public.game_account_entitlements enable row level security;
revoke all on table public.game_account_entitlements from public, anon, authenticated;
grant all on table public.game_account_entitlements to service_role;

create or replace function public.game_account_verified_email_bonus(p_account_id uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when exists (
    select 1
    from public.game_account_entitlements entitlement
    where entitlement.entitlement_code = 'verified_email_daily_attempt'
      and public.daily_game_account_id(entitlement.account_id)
        = public.daily_game_account_id(p_account_id)
  ) then 1 else 0 end;
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
  )
  select least(
    5,
    public.game_account_referral_bonus(selected.account_id)
      + greatest(0, legacy.total_bonus - legacy.historical_referral_bonus)
      + public.game_account_verified_email_bonus(selected.account_id)
  )::integer
  from selected cross join legacy;
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
  v_email_bonus integer := public.game_account_verified_email_bonus(v_account_id);
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
    'emailVerificationBonus', v_email_bonus,
    'completedReferrals', v_completed_referrals,
    'dailyLimitBase', 5,
    'dailyLimitCeiling', 10,
    'dailyQuotaDay', v_day,
    'dailyResetAt', public.game_server_reset_at(v_day)
  );
end;
$$;

revoke all on function public.game_account_verified_email_bonus(uuid) from public, anon, authenticated;
grant execute on function public.game_account_verified_email_bonus(uuid) to service_role;
