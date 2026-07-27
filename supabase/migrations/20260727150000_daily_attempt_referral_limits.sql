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

  select player, public.game_account_id_for_nick(player.nick_key)
  into v_referrer, v_referrer_account_id
  from public.game_players player
  where player.referral_code = p_referral_code;

  if not found or v_referrer_account_id is null then
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

create or replace function public.start_game_challenge(
  p_nick text,
  p_nick_key text,
  p_team text,
  p_device_hash text,
  p_ip_hash text,
  p_referral_code uuid default null,
  p_league_code text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempts_used integer;
  v_bonus_attempts integer := 0;
  v_max_attempts integer;
  v_challenge_id uuid;
  v_league public.game_leagues%rowtype;
  v_league_id uuid;
  v_is_global boolean := nullif(trim(coalesce(p_league_code, '')), '') is null;
  v_quota_day date := public.game_server_day(clock_timestamp());
  v_mode text;
  v_nonce uuid := gen_random_uuid();
  v_target_x smallint;
  v_target_y smallint;
  v_min_hold integer;
  v_max_hold integer;
  v_keyboard text;
  v_variant smallint;
begin
  if p_team not in ('spain', 'argentina')
     or char_length(p_nick) not between 2 and 24
     or char_length(p_nick_key) not between 2 and 24 then
    return jsonb_build_object('error', 'invalid_input');
  end if;

  if not v_is_global then
    select * into v_league
    from public.game_leagues
    where code = upper(trim(p_league_code));

    if not found then return jsonb_build_object('error', 'league_not_found'); end if;
    if v_league.ends_at <= clock_timestamp() then return jsonb_build_object('error', 'league_finished'); end if;
    if not exists (
      select 1 from public.game_league_members
      where league_id = v_league.id and nick_key = p_nick_key
    ) then
      return jsonb_build_object('error', 'league_membership_required');
    end if;
    v_league_id := v_league.id;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_nick_key || ':' || coalesce(v_league_id::text, 'global'),
    106
  ));

  insert into public.game_players(nick_key, nick, first_device_hash, first_ip_hash)
  values (p_nick_key, p_nick, p_device_hash, p_ip_hash)
  on conflict (nick_key) do update set nick = excluded.nick;

  insert into public.game_player_bonus(nick_key) values (p_nick_key)
  on conflict (nick_key) do nothing;

  if v_is_global and p_referral_code is not null then
    perform public.register_game_account_referral(
      p_referral_code,
      p_nick_key,
      p_device_hash,
      p_ip_hash
    );
  end if;

  select count(*)::integer into v_attempts_used
  from public.game_attempts attempt
  where attempt.nick_key = p_nick_key
    and attempt.league_id is not distinct from v_league_id
    and (not v_is_global or attempt.quota_day = v_quota_day);

  if v_is_global then
    v_bonus_attempts := public.game_player_daily_bonus(p_nick_key);
  end if;
  v_max_attempts := 5 + coalesce(v_bonus_attempts, 0);

  if v_attempts_used >= v_max_attempts then
    return jsonb_build_object(
      'error', 'nick_limit',
      'attemptsLeft', 0,
      'maxAttempts', v_max_attempts,
      'dailyResetAt', case when v_is_global then public.game_server_reset_at(v_quota_day) else null end
    );
  end if;

  if (select count(*) from public.game_challenges
      where device_hash = p_device_hash
        and started_at > clock_timestamp() - interval '1 minute') >= 8 then
    return jsonb_build_object('error', 'rate_limit');
  end if;

  if (select count(*) from public.game_challenges
      where ip_hash = p_ip_hash
        and started_at > clock_timestamp() - interval '1 minute') >= 40 then
    return jsonb_build_object('error', 'rate_limit');
  end if;

  if (select count(*) from public.game_attempts
      where device_hash = p_device_hash
        and created_at > clock_timestamp() - interval '24 hours') >= 150 then
    return jsonb_build_object('error', 'daily_limit');
  end if;

  v_mode := case when random() < 0.5 then 'press' else 'release' end;
  v_target_x := (34 + floor(random() * 33))::smallint;
  v_target_y := (40 + floor(random() * 21))::smallint;
  v_min_hold := case when v_mode = 'release' then 140 + floor(random() * 121)::integer else 0 end;
  v_max_hold := case when v_mode = 'release' then v_min_hold + 620 else 0 end;
  v_keyboard := case when random() < 0.5 then 'Enter' else 'Space' end;
  v_variant := floor(random() * 8)::smallint;

  insert into public.game_challenges (
    nick, nick_key, team, device_hash, ip_hash, league_id, quota_day,
    interaction_mode, interaction_nonce, target_x_percent, target_y_percent,
    min_hold_ms, max_hold_ms, keyboard_code, render_variant
  ) values (
    p_nick, p_nick_key, p_team, p_device_hash, p_ip_hash, v_league_id,
    case when v_is_global then v_quota_day else null end,
    v_mode, v_nonce, v_target_x, v_target_y,
    v_min_hold, v_max_hold, v_keyboard, v_variant
  ) returning id into v_challenge_id;

  return jsonb_build_object(
    'challengeId', v_challenge_id,
    'attemptsLeft', v_max_attempts - v_attempts_used,
    'maxAttempts', v_max_attempts,
    'bonusAttempts', v_bonus_attempts,
    'dailyResetAt', case when v_is_global then public.game_server_reset_at(v_quota_day) else null end,
    'competition', jsonb_build_object(
      'type', case when v_is_global then 'global' else 'league' end,
      'code', case when v_is_global then null else v_league.code end,
      'name', case when v_is_global then null else v_league.name end
    ),
    'interaction', jsonb_build_object(
      'mode', v_mode,
      'nonce', v_nonce,
      'xPercent', v_target_x,
      'yPercent', v_target_y,
      'minHoldMs', v_min_hold,
      'maxHoldMs', v_max_hold,
      'keyboardKey', v_keyboard,
      'variant', v_variant
    )
  );
end;
$$;

create or replace function public.start_game_challenge_pointer_only(
  p_nick text,
  p_nick_key text,
  p_team text,
  p_device_hash text,
  p_ip_hash text,
  p_referral_code uuid default null,
  p_league_code text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_challenge public.game_challenges%rowtype;
  v_completed_attempts integer := 0;
  v_active_challenges integer := 0;
  v_bonus_attempts integer := 0;
  v_max_attempts integer := 5;
  v_attempts_left integer := 0;
  v_is_global boolean;
begin
  v_result := public.start_game_challenge_pointer_only_without_reservations(
    p_nick,
    p_nick_key,
    p_team,
    p_device_hash,
    p_ip_hash,
    p_referral_code,
    p_league_code
  );

  if v_result ? 'error' then return v_result; end if;
  if nullif(v_result->>'challengeId', '') is null then
    return jsonb_build_object('error', 'invalid_input');
  end if;

  select * into v_challenge
  from public.game_challenges
  where id = (v_result->>'challengeId')::uuid
  for update;

  if not found then return jsonb_build_object('error', 'challenge_not_found'); end if;
  v_is_global := v_challenge.league_id is null;

  perform pg_advisory_xact_lock(hashtextextended(
    v_challenge.nick_key || ':' || coalesce(v_challenge.league_id::text, 'global'),
    106
  ));

  select count(*)::integer into v_completed_attempts
  from public.game_attempts attempt
  where attempt.nick_key = v_challenge.nick_key
    and attempt.league_id is not distinct from v_challenge.league_id
    and (not v_is_global or attempt.quota_day = v_challenge.quota_day);

  select count(*)::integer into v_active_challenges
  from public.game_challenges challenge
  where challenge.nick_key = v_challenge.nick_key
    and challenge.league_id is not distinct from v_challenge.league_id
    and (not v_is_global or challenge.quota_day = v_challenge.quota_day)
    and challenge.consumed_at is null
    and challenge.expires_at > clock_timestamp();

  if v_is_global then
    v_bonus_attempts := public.game_player_daily_bonus(v_challenge.nick_key);
  end if;
  v_max_attempts := 5 + v_bonus_attempts;

  if v_completed_attempts + v_active_challenges > v_max_attempts then
    update public.game_challenges
    set consumed_at = clock_timestamp()
    where id = v_challenge.id;

    v_attempts_left := greatest(0, v_max_attempts - v_completed_attempts - (v_active_challenges - 1));
    return jsonb_build_object(
      'error', 'nick_limit',
      'attemptsLeft', v_attempts_left,
      'maxAttempts', v_max_attempts,
      'dailyResetAt', case when v_is_global then public.game_server_reset_at(v_challenge.quota_day) else null end
    );
  end if;

  return v_result || jsonb_build_object(
    'attemptsLeft', greatest(0, v_max_attempts - v_completed_attempts - v_active_challenges + 1),
    'maxAttempts', v_max_attempts,
    'bonusAttempts', v_bonus_attempts,
    'dailyResetAt', case when v_is_global then public.game_server_reset_at(v_challenge.quota_day) else null end
  );
end;
$$;

create or replace function public.activate_game_challenge_pointer_only(
  p_challenge_id uuid,
  p_device_hash text,
  p_ip_hash text,
  p_countdown_ms integer
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_challenge public.game_challenges%rowtype;
  v_activated_at timestamptz := clock_timestamp();
  v_starts_at timestamptz;
  v_current_day date := public.game_server_day(v_activated_at);
  v_completed integer := 0;
  v_active integer := 0;
  v_max_attempts integer := 5;
begin
  if p_countdown_ms <> 3000 then return jsonb_build_object('error', 'invalid_countdown'); end if;

  select * into v_challenge
  from public.game_challenges
  where id = p_challenge_id
  for update;

  if not found then return jsonb_build_object('error', 'challenge_not_found'); end if;
  if v_challenge.consumed_at is not null then return jsonb_build_object('error', 'challenge_used'); end if;
  if v_challenge.prepared_at is null then return jsonb_build_object('error', 'challenge_not_prepared'); end if;
  if v_challenge.activated_at is not null then return jsonb_build_object('error', 'challenge_already_activated'); end if;
  if v_challenge.expires_at <= v_activated_at then return jsonb_build_object('error', 'challenge_expired'); end if;
  if v_challenge.device_hash <> p_device_hash or v_challenge.ip_hash <> p_ip_hash then
    return jsonb_build_object('error', 'device_mismatch');
  end if;

  if v_challenge.league_id is null and v_challenge.quota_day <> v_current_day then
    perform pg_advisory_xact_lock(hashtextextended(v_challenge.nick_key || ':global', 106));

    select count(*)::integer into v_completed
    from public.game_attempts attempt
    where attempt.nick_key = v_challenge.nick_key
      and attempt.league_id is null
      and attempt.quota_day = v_current_day;

    select count(*)::integer into v_active
    from public.game_challenges challenge
    where challenge.nick_key = v_challenge.nick_key
      and challenge.league_id is null
      and challenge.quota_day = v_current_day
      and challenge.id <> v_challenge.id
      and challenge.consumed_at is null
      and challenge.expires_at > v_activated_at;

    v_max_attempts := 5 + public.game_player_daily_bonus(v_challenge.nick_key);
    if v_completed + v_active >= v_max_attempts then
      update public.game_challenges set consumed_at = v_activated_at where id = v_challenge.id;
      return jsonb_build_object(
        'error', 'nick_limit',
        'attemptsLeft', 0,
        'maxAttempts', v_max_attempts,
        'dailyResetAt', public.game_server_reset_at(v_current_day)
      );
    end if;

    update public.game_challenges
    set quota_day = v_current_day
    where id = v_challenge.id;
  end if;

  v_starts_at := v_activated_at + p_countdown_ms * interval '1 millisecond';
  update public.game_challenges
  set activated_at = v_activated_at,
      started_at = v_starts_at,
      expires_at = v_starts_at + interval '30 seconds'
  where id = p_challenge_id;

  return jsonb_build_object(
    'ok', true,
    'activatedAt', v_activated_at,
    'startsAt', v_starts_at,
    'expiresAt', v_starts_at + interval '30 seconds'
  );
end;
$$;

create or replace function public.finish_game_attempt(
  p_challenge_id uuid,
  p_client_elapsed_ms integer,
  p_device_hash text,
  p_ip_hash text,
  p_client_signals jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_challenge public.game_challenges%rowtype;
  v_now timestamptz := clock_timestamp();
  v_server_elapsed_ms integer;
  v_difference_ms integer;
  v_attempts_used integer;
  v_bonus_attempts integer := 0;
  v_max_attempts integer;
  v_attempts_left integer;
  v_attempt_id uuid;
  v_verified boolean := true;
  v_reasons text[] := '{}';
  v_prior_near_perfect integer;
  v_signal_mode text := left(coalesce(p_client_signals->>'interactionMode', ''), 16);
  v_signal_nonce text := left(coalesce(p_client_signals->>'controlNonce', ''), 64);
  v_finish_event text := left(coalesce(p_client_signals->>'finishEvent', ''), 24);
  v_pointer_type text := left(coalesce(p_client_signals->>'pointerType', ''), 16);
  v_keyboard_key text := left(coalesce(p_client_signals->>'keyboardKey', ''), 16);
  v_signal_x numeric := -1;
  v_signal_y numeric := -1;
  v_hold_ms integer := -1;
  v_repeated_fingerprint integer := 0;
  v_league_code text;
  v_league_name text;
  v_is_global boolean;
  v_daily_state jsonb := '{}'::jsonb;
  v_referred_account_id uuid;
  v_is_timeout boolean := p_client_elapsed_ms = 30000
    and v_finish_event = ''
    and v_pointer_type = 'unknown'
    and coalesce(p_client_signals->>'pointerTrusted', 'false') = 'true'
    and coalesce(p_client_signals->>'timerConcealed', 'false') = 'true'
    and coalesce(p_client_signals->>'pointerMoveCount', '0') = '0'
    and coalesce(p_client_signals->>'pointerTravelPx', '0') = '0';
begin
  select * into v_challenge from public.game_challenges
  where id = p_challenge_id for update;

  if not found then return jsonb_build_object('error', 'challenge_not_found'); end if;
  if v_challenge.consumed_at is not null then return jsonb_build_object('error', 'challenge_used'); end if;

  update public.game_challenges set consumed_at = v_now where id = p_challenge_id;

  if v_is_timeout then
    if v_challenge.expires_at + interval '10 seconds' < v_now then
      return jsonb_build_object('error', 'challenge_expired');
    end if;
  elsif v_challenge.expires_at < v_now then
    return jsonb_build_object('error', 'challenge_expired');
  end if;

  if v_challenge.device_hash <> p_device_hash then return jsonb_build_object('error', 'device_mismatch'); end if;
  if p_client_elapsed_ms is null or p_client_elapsed_ms not between 2000 and 30000 then
    return jsonb_build_object('error', 'invalid_timing');
  end if;

  v_server_elapsed_ms := round(extract(epoch from (v_now - v_challenge.started_at)) * 1000)::integer;
  if v_is_timeout then
    if v_server_elapsed_ms not between 29500 and 40000 then return jsonb_build_object('error', 'invalid_timing'); end if;
  else
    if v_server_elapsed_ms not between 1800 and 35000 then return jsonb_build_object('error', 'invalid_timing'); end if;
    if abs(v_server_elapsed_ms - p_client_elapsed_ms) > 5000 then return jsonb_build_object('error', 'timing_mismatch'); end if;
  end if;

  if coalesce(p_client_signals->>'pointerXPercent', '') ~ '^-?[0-9]+([.][0-9]+)?$' then
    v_signal_x := (p_client_signals->>'pointerXPercent')::numeric;
  end if;
  if coalesce(p_client_signals->>'pointerYPercent', '') ~ '^-?[0-9]+([.][0-9]+)?$' then
    v_signal_y := (p_client_signals->>'pointerYPercent')::numeric;
  end if;
  if coalesce(p_client_signals->>'holdDurationMs', '') ~ '^[0-9]{1,5}$' then
    v_hold_ms := (p_client_signals->>'holdDurationMs')::integer;
  end if;

  v_is_global := v_challenge.league_id is null;
  perform pg_advisory_xact_lock(hashtextextended(
    v_challenge.nick_key || ':' || coalesce(v_challenge.league_id::text, 'global'),
    106
  ));

  select count(*)::integer into v_attempts_used
  from public.game_attempts attempt
  where attempt.nick_key = v_challenge.nick_key
    and attempt.league_id is not distinct from v_challenge.league_id
    and (not v_is_global or attempt.quota_day = v_challenge.quota_day);

  if v_is_global then
    v_bonus_attempts := public.game_player_daily_bonus(v_challenge.nick_key);
  end if;
  v_max_attempts := 5 + coalesce(v_bonus_attempts, 0);
  if v_attempts_used >= v_max_attempts then
    return jsonb_build_object(
      'error', 'nick_limit',
      'attemptsLeft', 0,
      'maxAttempts', v_max_attempts,
      'dailyResetAt', case when v_is_global then public.game_server_reset_at(v_challenge.quota_day) else null end
    );
  end if;

  v_difference_ms := abs(10600 - p_client_elapsed_ms);
  if not v_is_timeout and abs(v_server_elapsed_ms - p_client_elapsed_ms) > 3000 then
    v_verified := false;
    v_reasons := array_append(v_reasons, 'large_network_delta');
  end if;
  if v_challenge.ip_hash <> p_ip_hash then
    v_verified := false;
    v_reasons := array_append(v_reasons, 'ip_changed_during_attempt');
  end if;
  if coalesce(p_client_signals->>'trustedStart', 'false') <> 'true'
     or coalesce(p_client_signals->>'trustedFinish', 'false') <> 'true'
     or coalesce(p_client_signals->>'timerConcealed', 'false') <> 'true' then
    v_verified := false;
    v_reasons := array_append(v_reasons, 'invalid_client_interaction');
  end if;
  if coalesce(p_client_signals->>'visibilityChanges', '0') <> '0'
     or coalesce(p_client_signals->>'focusLosses', '0') <> '0' then
    v_verified := false;
    v_reasons := array_append(v_reasons, 'focus_changed_during_attempt');
  end if;

  if v_signal_mode <> v_challenge.interaction_mode
     or v_signal_nonce <> v_challenge.interaction_nonce::text then
    v_verified := false;
    v_reasons := array_append(v_reasons, 'interaction_challenge_mismatch');
  end if;

  if not v_is_timeout then
    if v_finish_event = 'keydown' then
      if coalesce(p_client_signals->>'pointerTrusted', 'false') <> 'true'
         or v_keyboard_key <> (case when v_challenge.keyboard_code = 'Space' then ' ' else 'Enter' end) then
        v_verified := false;
        v_reasons := array_append(v_reasons, 'invalid_keyboard_finish');
      end if;
    else
      if v_finish_event <> (case when v_challenge.interaction_mode = 'release' then 'pointerup' else 'pointerdown' end)
         or coalesce(p_client_signals->>'pointerTrusted', 'false') <> 'true'
         or coalesce(p_client_signals->>'userActivation', 'false') <> 'true' then
        v_verified := false;
        v_reasons := array_append(v_reasons, 'invalid_pointer_finish');
      end if;
      if abs(v_signal_x - v_challenge.target_x_percent) > 18
         or abs(v_signal_y - v_challenge.target_y_percent) > 18 then
        v_verified := false;
        v_reasons := array_append(v_reasons, 'pointer_outside_target');
      end if;
      if v_challenge.interaction_mode = 'release'
         and (v_hold_ms not between v_challenge.min_hold_ms and v_challenge.max_hold_ms
              or coalesce(p_client_signals->>'samePointer', 'false') <> 'true') then
        v_verified := false;
        v_reasons := array_append(v_reasons, 'invalid_hold_gesture');
      end if;
    end if;
  end if;

  if coalesce(p_client_signals->>'automationDetected', 'false') = 'true' then
    v_verified := false;
    v_reasons := array_append(v_reasons, 'browser_automation_detected');
  end if;

  if not v_is_timeout then
    select count(*)::integer into v_repeated_fingerprint
    from public.game_attempts
    where device_hash = p_device_hash
      and created_at > v_now - interval '24 hours'
      and client_signals->>'finishEvent' = v_finish_event
      and client_signals->>'pointerType' = v_pointer_type
      and client_signals->>'pointerXPercent' = p_client_signals->>'pointerXPercent'
      and client_signals->>'pointerYPercent' = p_client_signals->>'pointerYPercent'
      and client_signals->>'holdDurationMs' = p_client_signals->>'holdDurationMs'
      and client_signals->>'pointerMoveCount' = p_client_signals->>'pointerMoveCount';
    if v_repeated_fingerprint >= 2 then
      v_verified := false;
      v_reasons := array_append(v_reasons, 'repeated_interaction_fingerprint');
    end if;
  end if;

  select count(*)::integer into v_prior_near_perfect
  from public.game_attempts
  where (device_hash = p_device_hash or ip_hash = p_ip_hash)
    and difference_ms <= 5
    and created_at > v_now - interval '24 hours';
  if v_difference_ms <= 5 and v_prior_near_perfect >= 2 then
    v_verified := false;
    v_reasons := array_append(v_reasons, 'repeated_near_perfect_results');
  end if;

  insert into public.game_attempts (
    challenge_id, nick, nick_key, team, device_hash, ip_hash, league_id, quota_day,
    client_elapsed_ms, server_elapsed_ms, difference_ms,
    verified, verification_reasons, client_signals
  ) values (
    v_challenge.id, v_challenge.nick, v_challenge.nick_key, v_challenge.team,
    v_challenge.device_hash, p_ip_hash, v_challenge.league_id,
    case when v_is_global then v_challenge.quota_day else null end,
    p_client_elapsed_ms, v_server_elapsed_ms,
    v_difference_ms, v_verified, v_reasons, coalesce(p_client_signals, '{}'::jsonb)
  ) returning id into v_attempt_id;

  if v_verified and v_is_global then
    v_referred_account_id := public.game_account_id_for_nick(v_challenge.nick_key);
    perform public.complete_game_account_referral(v_referred_account_id, v_now);
  end if;

  if not v_is_global then
    select code, name into v_league_code, v_league_name
    from public.game_leagues where id = v_challenge.league_id;
  end if;

  if v_is_global then
    v_daily_state := public.get_game_daily_attempt_state(v_challenge.nick_key, v_now);
    v_attempts_left := coalesce((v_daily_state->>'attemptsLeft')::integer, 0);
    v_max_attempts := coalesce((v_daily_state->>'maxAttempts')::integer, v_max_attempts);
    v_bonus_attempts := coalesce((v_daily_state->>'bonusAttempts')::integer, v_bonus_attempts);
  else
    v_attempts_left := v_max_attempts - v_attempts_used - 1;
  end if;

  return jsonb_build_object(
    'attempt', jsonb_build_object(
      'id', v_attempt_id,
      'nick', v_challenge.nick,
      'team', v_challenge.team,
      'elapsedMs', p_client_elapsed_ms,
      'differenceMs', v_difference_ms,
      'verified', v_verified,
      'createdAt', v_now,
      'competitionType', case when v_is_global then 'global' else 'league' end,
      'leagueCode', v_league_code,
      'leagueName', v_league_name
    ),
    'competition', jsonb_build_object(
      'type', case when v_is_global then 'global' else 'league' end,
      'code', v_league_code,
      'name', v_league_name
    ),
    'attemptsLeft', v_attempts_left,
    'maxAttempts', v_max_attempts,
    'bonusAttempts', v_bonus_attempts,
    'dailyResetAt', case when v_is_global then v_daily_state->'dailyResetAt' else null end
  );
end;
$$;

do $$
begin
  if to_regprocedure('public.get_game_player_profile_without_daily_limits(text)') is null then
    alter function public.get_game_player_profile(text)
      rename to get_game_player_profile_without_daily_limits;
  end if;
end;
$$;

create or replace function public.get_game_player_profile(p_nick_key text)
returns jsonb
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.get_game_player_profile_without_daily_limits(p_nick_key), '{}'::jsonb)
    || public.get_game_daily_attempt_state(p_nick_key, clock_timestamp());
$$;

do $$
begin
  if to_regprocedure('public.get_game_account_players_without_daily_limits(text)') is null then
    alter function public.get_game_account_players(text)
      rename to get_game_account_players_without_daily_limits;
  end if;
end;
$$;

create or replace function public.get_game_account_players(p_account_token_hash text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_base jsonb := public.get_game_account_players_without_daily_limits(p_account_token_hash);
  v_player jsonb;
  v_players jsonb := '[]'::jsonb;
  v_state jsonb;
begin
  for v_player in
    select value from jsonb_array_elements(coalesce(v_base->'players', '[]'::jsonb))
  loop
    v_state := public.get_game_daily_attempt_state(
      coalesce(nullif(v_player->>'nickKey', ''), lower(v_player->>'nick')),
      clock_timestamp()
    );
    v_players := v_players || jsonb_build_array(v_player || v_state);
  end loop;

  return jsonb_set(coalesce(v_base, '{}'::jsonb), '{players}', v_players, true);
end;
$$;

revoke all on function public.game_server_day(timestamptz) from public, anon, authenticated;
revoke all on function public.game_server_reset_at(date) from public, anon, authenticated;
revoke all on function public.daily_game_account_id(uuid) from public, anon, authenticated;
revoke all on function public.game_account_id_for_nick(text) from public, anon, authenticated;
revoke all on function public.game_account_completed_referrals(uuid) from public, anon, authenticated;
revoke all on function public.game_account_referral_bonus(uuid) from public, anon, authenticated;
revoke all on function public.game_player_daily_bonus(text) from public, anon, authenticated;
revoke all on function public.get_game_daily_attempt_state(text, timestamptz) from public, anon, authenticated;
revoke all on function public.register_game_account_referral(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.complete_game_account_referral(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.start_game_challenge(text, text, text, text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.start_game_challenge_pointer_only(text, text, text, text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.activate_game_challenge_pointer_only(uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.finish_game_attempt(uuid, integer, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.get_game_player_profile_without_daily_limits(text) from public, anon, authenticated, service_role;
revoke all on function public.get_game_player_profile(text) from public, anon, authenticated;
revoke all on function public.get_game_account_players_without_daily_limits(text) from public, anon, authenticated, service_role;
revoke all on function public.get_game_account_players(text) from public, anon, authenticated;

grant execute on function public.game_server_day(timestamptz) to service_role;
grant execute on function public.game_server_reset_at(date) to service_role;
grant execute on function public.daily_game_account_id(uuid) to service_role;
grant execute on function public.game_account_id_for_nick(text) to service_role;
grant execute on function public.game_account_completed_referrals(uuid) to service_role;
grant execute on function public.game_account_referral_bonus(uuid) to service_role;
grant execute on function public.game_player_daily_bonus(text) to service_role;
grant execute on function public.get_game_daily_attempt_state(text, timestamptz) to service_role;
grant execute on function public.register_game_account_referral(uuid, text, text, text) to service_role;
grant execute on function public.complete_game_account_referral(uuid, timestamptz) to service_role;
grant execute on function public.start_game_challenge(text, text, text, text, text, uuid, text) to service_role;
grant execute on function public.start_game_challenge_pointer_only(text, text, text, text, text, uuid, text) to service_role;
grant execute on function public.activate_game_challenge_pointer_only(uuid, text, text, integer) to service_role;
grant execute on function public.finish_game_attempt(uuid, integer, text, text, jsonb) to service_role;
grant execute on function public.get_game_player_profile(text) to service_role;
grant execute on function public.get_game_account_players(text) to service_role;
