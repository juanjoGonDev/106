create or replace function public.game_account_auth_daily_bonus(p_account_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_account_id uuid := public.daily_game_account_id(p_account_id);
  v_bonus integer := 0;
begin
  if v_account_id is null or to_regclass('public.game_account_entitlements') is null then
    return 0;
  end if;

  execute $query$
    select case when exists (
      select 1
      from public.game_account_entitlements entitlement
      where entitlement.entitlement_code in (
          'auth_identity_daily_attempt',
          'verified_email_daily_attempt'
        )
        and public.daily_game_account_id(entitlement.account_id)
          = public.daily_game_account_id($1)
    ) then 1 else 0 end
  $query$ using v_account_id into v_bonus;

  return coalesce(v_bonus, 0);
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
  )
  select least(
    5,
    public.game_account_referral_bonus(selected.account_id)
      + greatest(0, legacy.total_bonus - legacy.historical_referral_bonus)
      + public.game_account_auth_daily_bonus(selected.account_id)
  )::integer
  from selected cross join legacy;
$$;

revoke all on function public.game_account_auth_daily_bonus(uuid) from public, anon, authenticated;
revoke all on function public.game_player_daily_bonus(text) from public, anon, authenticated;
grant execute on function public.game_account_auth_daily_bonus(uuid) to service_role;
grant execute on function public.game_player_daily_bonus(text) to service_role;
