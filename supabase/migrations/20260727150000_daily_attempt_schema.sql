alter table public.game_challenges
  add column if not exists quota_day date;

alter table public.game_attempts
  add column if not exists quota_day date;

update public.game_challenges
set quota_day = (started_at at time zone 'UTC')::date
where league_id is null
  and quota_day is null;

update public.game_attempts
set quota_day = (created_at at time zone 'UTC')::date
where league_id is null
  and quota_day is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'game_challenges_global_quota_day_check'
      and conrelid = 'public.game_challenges'::regclass
  ) then
    alter table public.game_challenges
      add constraint game_challenges_global_quota_day_check
      check (league_id is not null or quota_day is not null) not valid;
    alter table public.game_challenges
      validate constraint game_challenges_global_quota_day_check;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'game_attempts_global_quota_day_check'
      and conrelid = 'public.game_attempts'::regclass
  ) then
    alter table public.game_attempts
      add constraint game_attempts_global_quota_day_check
      check (league_id is not null or quota_day is not null) not valid;
    alter table public.game_attempts
      validate constraint game_attempts_global_quota_day_check;
  end if;
end;
$$;

create index if not exists game_challenges_daily_quota_idx
  on public.game_challenges(nick_key, quota_day, expires_at)
  where league_id is null and consumed_at is null;

create index if not exists game_attempts_daily_quota_idx
  on public.game_attempts(nick_key, quota_day, created_at)
  where league_id is null;

alter table public.game_referrals
  add column if not exists referrer_account_id uuid references public.game_accounts(id) on delete restrict,
  add column if not exists referred_account_id uuid references public.game_accounts(id) on delete restrict,
  add column if not exists reward_eligible boolean not null default false,
  add column if not exists ineligible_reason text;

create or replace function public.game_server_day(p_at timestamptz)
returns date
language sql
immutable
parallel safe
as $$
  select (p_at at time zone 'UTC')::date;
$$;

create or replace function public.game_server_reset_at(p_day date)
returns timestamptz
language sql
immutable
parallel safe
as $$
  select ((p_day + 1)::timestamp at time zone 'UTC');
$$;

create or replace function public.daily_game_account_id(p_account_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_account_id uuid := p_account_id;
  v_resolved uuid;
begin
  if v_account_id is null then return null; end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'game_accounts'
      and column_name = 'merged_into_account_id'
  ) then
    execute $query$
      with recursive chain as (
        select account.id, account.merged_into_account_id, 0 as depth
        from public.game_accounts account
        where account.id = $1
        union all
        select account.id, account.merged_into_account_id, chain.depth + 1
        from chain
        join public.game_accounts account on account.id = chain.merged_into_account_id
        where chain.merged_into_account_id is not null
          and chain.depth < 31
      )
      select id
      from chain
      order by depth desc
      limit 1
    $query$ using v_account_id into v_resolved;

    return coalesce(v_resolved, v_account_id);
  end if;

  return v_account_id;
end;
$$;

create or replace function public.game_account_id_for_nick(p_nick_key text)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.daily_game_account_id(account_player.account_id)
  from public.game_account_players account_player
  where account_player.nick_key = p_nick_key;
$$;

update public.game_referrals referral
set referrer_account_id = account_player.account_id
from public.game_account_players account_player
where account_player.nick_key = referral.referrer_nick_key
  and referral.referrer_account_id is null;

update public.game_referrals referral
set referred_account_id = account_player.account_id
from public.game_account_players account_player
where account_player.nick_key = referral.referred_nick_key
  and referral.referred_account_id is null;

with valid_candidates as (
  select referral.id,
    row_number() over(
      partition by public.daily_game_account_id(referral.referred_account_id)
      order by referral.created_at, referral.id
    ) as account_sequence
  from public.game_referrals referral
  join public.game_players referrer on referrer.nick_key = referral.referrer_nick_key
  where referral.referrer_account_id is not null
    and referral.referred_account_id is not null
    and public.daily_game_account_id(referral.referrer_account_id)
      <> public.daily_game_account_id(referral.referred_account_id)
    and referrer.first_device_hash <> referral.referred_device_hash
    and referrer.first_ip_hash <> referral.referred_ip_hash
), classified as (
  select referral.id,
    coalesce(candidate.account_sequence = 1, false) as reward_eligible,
    case
      when referral.referrer_account_id is null or referral.referred_account_id is null then 'account_missing'
      when public.daily_game_account_id(referral.referrer_account_id)
        = public.daily_game_account_id(referral.referred_account_id) then 'same_account'
      when referrer.first_device_hash = referral.referred_device_hash then 'same_device'
      when referrer.first_ip_hash = referral.referred_ip_hash then 'same_ip'
      when candidate.account_sequence > 1 then 'duplicate_referred_account'
      else null
    end as ineligible_reason
  from public.game_referrals referral
  join public.game_players referrer on referrer.nick_key = referral.referrer_nick_key
  left join valid_candidates candidate on candidate.id = referral.id
)
update public.game_referrals referral
set reward_eligible = classified.reward_eligible,
    ineligible_reason = classified.ineligible_reason
from classified
where classified.id = referral.id;

create unique index if not exists game_referrals_one_eligible_account_idx
  on public.game_referrals(referred_account_id)
  where reward_eligible = true;

create index if not exists game_referrals_referrer_account_completed_idx
  on public.game_referrals(referrer_account_id, completed_at)
  where reward_eligible = true;

create or replace function public.game_account_completed_referrals(p_account_id uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(distinct public.daily_game_account_id(referral.referred_account_id))::integer
  from public.game_referrals referral
  where referral.reward_eligible = true
    and referral.completed_at is not null
    and public.daily_game_account_id(referral.referrer_account_id)
      = public.daily_game_account_id(p_account_id)
    and public.daily_game_account_id(referral.referred_account_id)
      <> public.daily_game_account_id(p_account_id);
$$;

create or replace function public.game_account_referral_bonus(p_account_id uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select least(5, public.game_account_completed_referrals(p_account_id));
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
  )::integer
  from selected cross join legacy;
$$;
