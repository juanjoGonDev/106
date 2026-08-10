alter table public.game_trophy_award_runs
  add column if not exists policy_version integer not null default 1
  check (policy_version > 0);

create table if not exists public.game_attempt_integrity (
  attempt_id uuid primary key references public.game_attempts(id) on delete cascade,
  hard_valid boolean not null,
  status text not null check (status in ('eligible', 'watch', 'excluded')),
  risk_score smallint not null default 0 check (risk_score between 0 and 100),
  risk_reasons text[] not null default '{}'::text[],
  evidence jsonb not null default '{}'::jsonb,
  policy_version integer not null default 2 check (policy_version > 0),
  evaluated_at timestamptz not null default clock_timestamp()
);

create table if not exists public.game_attempt_integrity_events (
  id bigint generated always as identity primary key,
  attempt_id uuid not null references public.game_attempts(id) on delete cascade,
  previous_status text check (previous_status is null or previous_status in ('eligible', 'watch', 'excluded')),
  next_status text not null check (next_status in ('eligible', 'watch', 'excluded')),
  previous_score smallint check (previous_score is null or previous_score between 0 and 100),
  next_score smallint not null check (next_score between 0 and 100),
  reasons text[] not null default '{}'::text[],
  evidence jsonb not null default '{}'::jsonb,
  policy_version integer not null check (policy_version > 0),
  changed_at timestamptz not null default clock_timestamp()
);

create index if not exists game_attempt_integrity_status_idx
  on public.game_attempt_integrity(status, hard_valid, evaluated_at desc);
create index if not exists game_attempt_integrity_policy_idx
  on public.game_attempt_integrity(policy_version, evaluated_at desc);
create index if not exists game_attempt_integrity_events_attempt_idx
  on public.game_attempt_integrity_events(attempt_id, changed_at desc, id desc);
create index if not exists game_attempts_integrity_device_window_idx
  on public.game_attempts(device_hash, created_at desc, difference_ms, nick_key);
create index if not exists game_attempts_integrity_ip_window_idx
  on public.game_attempts(ip_hash, created_at desc, difference_ms, device_hash);

alter table public.game_attempt_integrity enable row level security;
alter table public.game_attempt_integrity_events enable row level security;
revoke all on table public.game_attempt_integrity, public.game_attempt_integrity_events
  from public, anon, authenticated;
grant all on table public.game_attempt_integrity, public.game_attempt_integrity_events
  to service_role;

create or replace function public.game_attempt_hard_valid(
  p_verified boolean,
  p_reasons text[]
) returns boolean
language sql
immutable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(p_verified, false)
    or (
      not coalesce(p_verified, false)
      and cardinality(coalesce(p_reasons, '{}'::text[])) > 0
      and coalesce(p_reasons, '{}'::text[]) <@ array[
        'repeated_near_perfect_results',
        'repeated_interaction_fingerprint'
      ]::text[]
    );
$$;

create or replace function public.game_attempt_client_telemetry(p_signals jsonb)
returns jsonb
language sql
immutable
security definer
set search_path = public, pg_temp
as $$
  select case
    when jsonb_typeof(coalesce(p_signals, '{}'::jsonb)->'clientTelemetry') = 'object'
      then coalesce(p_signals, '{}'::jsonb)->'clientTelemetry'
    when jsonb_typeof(coalesce(p_signals, '{}'::jsonb)) = 'object'
      then coalesce(p_signals, '{}'::jsonb)
    else '{}'::jsonb
  end;
$$;

create or replace function public.game_attempt_interaction_fingerprint(p_signals jsonb)
returns text
language sql
immutable
security definer
set search_path = public, pg_temp
as $$
with telemetry as (
  select public.game_attempt_client_telemetry(p_signals) as value
)
select case
  when not (value ? 'pointerType')
    or not (value ? 'pointerMoveCount')
    or coalesce(value->>'automaticFinish', 'false') = 'true'
    then null
  else concat_ws('|',
    coalesce(value->>'finishEvent', ''),
    coalesce(value->>'pointerType', ''),
    coalesce(value->>'pointerMoveCount', ''),
    coalesce(value->>'pointerTravelPx', ''),
    coalesce(value->>'pointerDwellMs', ''),
    coalesce(value->>'pressureMax', ''),
    coalesce(value->>'userActivation', ''),
    coalesce(value->>'automationDetected', '')
  )
end
from telemetry;
$$;

create or replace function public.seed_game_attempt_integrity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hard_valid boolean := public.game_attempt_hard_valid(new.verified, new.verification_reasons);
begin
  insert into public.game_attempt_integrity(
    attempt_id,
    hard_valid,
    status,
    risk_score,
    risk_reasons,
    evidence,
    policy_version,
    evaluated_at
  ) values (
    new.id,
    v_hard_valid,
    case when v_hard_valid then 'eligible' else 'excluded' end,
    0,
    case when v_hard_valid then '{}'::text[] else coalesce(new.verification_reasons, '{}'::text[]) end,
    jsonb_build_object(
      'source', 'attempt_insert',
      'originalVerified', new.verified,
      'originalReasons', coalesce(to_jsonb(new.verification_reasons), '[]'::jsonb)
    ),
    2,
    clock_timestamp()
  )
  on conflict (attempt_id) do nothing;

  return new;
end;
$$;

drop trigger if exists game_attempts_seed_integrity on public.game_attempts;
create trigger game_attempts_seed_integrity
after insert on public.game_attempts
for each row execute function public.seed_game_attempt_integrity();

insert into public.game_attempt_integrity(
  attempt_id,
  hard_valid,
  status,
  risk_score,
  risk_reasons,
  evidence,
  policy_version,
  evaluated_at
)
select
  attempt.id,
  public.game_attempt_hard_valid(attempt.verified, attempt.verification_reasons),
  case
    when public.game_attempt_hard_valid(attempt.verified, attempt.verification_reasons)
      then 'eligible'
    else 'excluded'
  end,
  0,
  case
    when public.game_attempt_hard_valid(attempt.verified, attempt.verification_reasons)
      then '{}'::text[]
    else coalesce(attempt.verification_reasons, '{}'::text[])
  end,
  jsonb_build_object(
    'source', 'legacy_backfill',
    'originalVerified', attempt.verified,
    'originalReasons', coalesce(to_jsonb(attempt.verification_reasons), '[]'::jsonb)
  ),
  2,
  clock_timestamp()
from public.game_attempts attempt
on conflict (attempt_id) do nothing;

create or replace function public.rebuild_game_player_achievements(p_nick_key text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_total integer := 0;
  v_added integer := 0;
begin
  if not exists (select 1 from public.game_players player where player.nick_key = p_nick_key) then
    return 0;
  end if;

  delete from public.game_player_achievements achievement
  where achievement.nick_key = p_nick_key;

  v_added := public.refresh_game_player_achievements(p_nick_key);
  v_total := v_total + coalesce(v_added, 0);

  v_added := public.refresh_game_player_progression_achievements(p_nick_key);
  v_total := v_total + coalesce(v_added, 0);

  update public.game_player_featured_achievements featured
  set active = false,
      updated_at = clock_timestamp()
  where featured.nick_key = p_nick_key
    and featured.active = true
    and not exists (
      select 1
      from public.game_player_achievements achievement
      where achievement.nick_key = featured.nick_key
        and achievement.achievement_code = featured.achievement_code
    );

  return v_total;
end;
$$;

create or replace function public.refresh_game_attempt_progression_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(current_setting('minuto106.integrity_reconcile', true), '') = 'on'
     or coalesce(current_setting('minuto106.integrity_bulk', true), '') = 'on' then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.verified is distinct from new.verified then
    perform public.rebuild_game_player_achievements(new.nick_key);
  else
    perform public.refresh_game_player_progression_achievements(new.nick_key);
  end if;

  return new;
end;
$$;

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

  perform pg_advisory_xact_lock(hashtextextended('integrity-referral:' || v_account_id::text, 106));

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

create or replace function public.game_attempt_integrity_evidence(p_anchor_attempt_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_anchor public.game_attempts%rowtype;
  v_anchor_account_id uuid;
  v_anchor_fingerprint text;
  v_window_start timestamptz;
  v_same_device_near_perfect integer := 0;
  v_distinct_device_nicks integer := 0;
  v_distinct_device_accounts integer := 0;
  v_same_account_nicks integer := 0;
  v_same_ip_near_perfect integer := 0;
  v_same_ip_devices integer := 0;
  v_fingerprint_matches integer := 0;
  v_automation_shape_matches integer := 0;
begin
  select attempt.* into v_anchor
  from public.game_attempts attempt
  where attempt.id = p_anchor_attempt_id;

  if not found then
    return jsonb_build_object('error', 'attempt_not_found');
  end if;

  v_window_start := v_anchor.created_at - interval '24 hours';
  v_anchor_account_id := public.game_account_id_for_nick(v_anchor.nick_key);
  v_anchor_fingerprint := public.game_attempt_interaction_fingerprint(v_anchor.client_signals);

  select
    count(*)::integer,
    count(distinct attempt.nick_key)::integer,
    count(distinct public.daily_game_account_id(account_player.account_id))
      filter (where account_player.account_id is not null)::integer
  into
    v_same_device_near_perfect,
    v_distinct_device_nicks,
    v_distinct_device_accounts
  from public.game_attempts attempt
  join public.game_attempt_integrity integrity on integrity.attempt_id = attempt.id
  left join public.game_account_players account_player on account_player.nick_key = attempt.nick_key
  where integrity.hard_valid = true
    and attempt.device_hash = v_anchor.device_hash
    and attempt.difference_ms <= 5
    and attempt.created_at between v_window_start and v_anchor.created_at;

  if v_anchor_account_id is not null then
    select count(distinct attempt.nick_key)::integer
    into v_same_account_nicks
    from public.game_attempts attempt
    join public.game_attempt_integrity integrity on integrity.attempt_id = attempt.id
    join public.game_account_players account_player on account_player.nick_key = attempt.nick_key
    where integrity.hard_valid = true
      and public.daily_game_account_id(account_player.account_id)
        = public.daily_game_account_id(v_anchor_account_id)
      and attempt.difference_ms <= 5
      and attempt.created_at between v_window_start and v_anchor.created_at;
  end if;

  select
    count(*)::integer,
    count(distinct attempt.device_hash)::integer
  into v_same_ip_near_perfect, v_same_ip_devices
  from public.game_attempts attempt
  join public.game_attempt_integrity integrity on integrity.attempt_id = attempt.id
  where integrity.hard_valid = true
    and attempt.ip_hash = v_anchor.ip_hash
    and attempt.difference_ms <= 5
    and attempt.created_at between v_window_start and v_anchor.created_at;

  if v_anchor_fingerprint is not null then
    select count(*)::integer
    into v_fingerprint_matches
    from public.game_attempts attempt
    join public.game_attempt_integrity integrity on integrity.attempt_id = attempt.id
    where integrity.hard_valid = true
      and attempt.device_hash = v_anchor.device_hash
      and attempt.difference_ms <= 5
      and attempt.created_at between v_window_start and v_anchor.created_at
      and public.game_attempt_interaction_fingerprint(attempt.client_signals) = v_anchor_fingerprint;
  end if;

  select count(*)::integer
  into v_automation_shape_matches
  from public.game_attempts attempt
  join public.game_attempt_integrity integrity on integrity.attempt_id = attempt.id
  cross join lateral (
    select public.game_attempt_client_telemetry(attempt.client_signals) as telemetry
  ) signal
  where integrity.hard_valid = true
    and attempt.device_hash = v_anchor.device_hash
    and attempt.difference_ms <= 5
    and attempt.created_at between v_window_start and v_anchor.created_at
    and signal.telemetry ? 'userActivation'
    and signal.telemetry ? 'pointerMoveCount'
    and signal.telemetry ? 'pointerTravelPx'
    and signal.telemetry ? 'pointerDwellMs'
    and coalesce(signal.telemetry->>'automaticFinish', 'false') <> 'true'
    and coalesce(signal.telemetry->>'userActivation', 'false') = 'false'
    and coalesce(signal.telemetry->>'pointerMoveCount', '') = '0'
    and coalesce(signal.telemetry->>'pointerTravelPx', '') = '0'
    and coalesce(signal.telemetry->>'pointerDwellMs', '') = '0';

  return jsonb_build_object(
    'anchorAttemptId', v_anchor.id,
    'windowStart', v_window_start,
    'windowEnd', v_anchor.created_at,
    'sameDeviceNearPerfect', v_same_device_near_perfect,
    'distinctDeviceNicks', v_distinct_device_nicks,
    'distinctDeviceAccounts', v_distinct_device_accounts,
    'sameAccountNicks', v_same_account_nicks,
    'sameIpNearPerfect', v_same_ip_near_perfect,
    'sameIpDevices', v_same_ip_devices,
    'fingerprintMatches', v_fingerprint_matches,
    'automationShapeMatches', v_automation_shape_matches,
    'fingerprintAvailable', v_anchor_fingerprint is not null
  );
end;
$$;

create or replace function public.game_attempt_integrity_decision(p_evidence jsonb)
returns jsonb
language plpgsql
immutable
security definer
set search_path = public, pg_temp
as $$
declare
  v_near integer := greatest(0, coalesce((p_evidence->>'sameDeviceNearPerfect')::integer, 0));
  v_nicks integer := greatest(0, coalesce((p_evidence->>'distinctDeviceNicks')::integer, 0));
  v_accounts integer := greatest(0, coalesce((p_evidence->>'distinctDeviceAccounts')::integer, 0));
  v_account_nicks integer := greatest(0, coalesce((p_evidence->>'sameAccountNicks')::integer, 0));
  v_ip_near integer := greatest(0, coalesce((p_evidence->>'sameIpNearPerfect')::integer, 0));
  v_ip_devices integer := greatest(0, coalesce((p_evidence->>'sameIpDevices')::integer, 0));
  v_fingerprint integer := greatest(0, coalesce((p_evidence->>'fingerprintMatches')::integer, 0));
  v_automation_shape integer := greatest(0, coalesce((p_evidence->>'automationShapeMatches')::integer, 0));
  v_score integer := 0;
  v_status text := 'eligible';
  v_reasons text[] := '{}'::text[];
begin
  v_score := v_score + case
    when v_near >= 8 then 30
    when v_near >= 6 then 25
    when v_near >= 4 then 20
    when v_near >= 3 then 10
    else 0
  end;
  if v_near >= 3 then
    v_reasons := array_append(v_reasons, 'near_perfect_frequency');
  end if;

  v_score := v_score + case
    when v_nicks >= 4 then 30
    when v_nicks >= 3 then 25
    when v_nicks >= 2 then 10
    else 0
  end;
  if v_nicks >= 2 then
    v_reasons := array_append(v_reasons, 'cross_nick_same_device');
  end if;

  v_score := v_score + case
    when v_fingerprint >= 4 then 25
    when v_fingerprint >= 3 then 20
    when v_fingerprint >= 2 then 10
    else 0
  end;
  if v_fingerprint >= 2 then
    v_reasons := array_append(v_reasons, 'repeated_interaction_pattern');
  end if;

  v_score := v_score + case
    when v_automation_shape >= 4 then 30
    when v_automation_shape >= 3 then 15
    else 0
  end;
  if v_automation_shape >= 3 then
    v_reasons := array_append(v_reasons, 'repeated_zero_motion_activation_gap');
  end if;

  if v_accounts >= 2 or v_account_nicks >= 3 then
    v_score := v_score + 5;
    v_reasons := array_append(v_reasons, 'multi_identity_context');
  end if;

  if v_ip_near >= 6 and v_ip_devices >= 3 then
    v_score := v_score + 5;
    v_reasons := array_append(v_reasons, 'shared_ip_context');
  end if;

  v_score := least(100, v_score);

  if v_score >= 65
     and v_near >= 4
     and v_fingerprint >= 3
     and (v_nicks >= 3 or v_automation_shape >= 4) then
    v_status := 'excluded';
  elsif v_score >= 35 then
    v_status := 'watch';
  end if;

  return jsonb_build_object(
    'status', v_status,
    'riskScore', v_score,
    'reasons', to_jsonb(v_reasons),
    'policyVersion', 2
  );
end;
$$;

create or replace function public.get_game_profile_revision(p_nick_key text)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select floor(extract(epoch from coalesce(max(changes.changed_at), 'epoch'::timestamptz)) * 1000)::bigint
  from (
    select player.created_at as changed_at
    from public.game_players player where player.nick_key = p_nick_key
    union all select attempt.created_at
      from public.game_attempts attempt where attempt.nick_key = p_nick_key and attempt.league_id is null
    union all select integrity.evaluated_at
      from public.game_attempts attempt
      join public.game_attempt_integrity integrity on integrity.attempt_id = attempt.id
      where attempt.nick_key = p_nick_key
    union all select bonus.updated_at
      from public.game_player_bonus bonus where bonus.nick_key = p_nick_key
    union all select referral.completed_at
      from public.game_referrals referral
      where referral.referrer_nick_key = p_nick_key and referral.completed_at is not null
    union all select trophy.awarded_at
      from public.game_daily_trophies trophy where trophy.nick_key = p_nick_key
    union all select achievement.awarded_at
      from public.game_player_achievements achievement where achievement.nick_key = p_nick_key
    union all select featured.updated_at
      from public.game_player_featured_achievements featured where featured.nick_key = p_nick_key
    union all select trophy.awarded_at
      from public.game_league_trophies trophy where trophy.nick_key = p_nick_key
  ) changes;
$$;

revoke all on function public.game_attempt_hard_valid(boolean, text[]) from public, anon, authenticated;
revoke all on function public.game_attempt_client_telemetry(jsonb) from public, anon, authenticated;
revoke all on function public.game_attempt_interaction_fingerprint(jsonb) from public, anon, authenticated;
revoke all on function public.seed_game_attempt_integrity() from public, anon, authenticated;
revoke all on function public.rebuild_game_player_achievements(text) from public, anon, authenticated;
revoke all on function public.reconcile_game_account_referral(uuid) from public, anon, authenticated;
revoke all on function public.game_attempt_integrity_evidence(uuid) from public, anon, authenticated;
revoke all on function public.game_attempt_integrity_decision(jsonb) from public, anon, authenticated;
revoke all on function public.get_game_profile_revision(text) from public, anon, authenticated;

grant execute on function public.game_attempt_hard_valid(boolean, text[]) to service_role;
grant execute on function public.game_attempt_client_telemetry(jsonb) to service_role;
grant execute on function public.game_attempt_interaction_fingerprint(jsonb) to service_role;
grant execute on function public.seed_game_attempt_integrity() to service_role;
grant execute on function public.rebuild_game_player_achievements(text) to service_role;
grant execute on function public.reconcile_game_account_referral(uuid) to service_role;
grant execute on function public.game_attempt_integrity_evidence(uuid) to service_role;
grant execute on function public.game_attempt_integrity_decision(jsonb) to service_role;
grant execute on function public.get_game_profile_revision(text) to service_role;

comment on table public.game_attempt_integrity is
  'Authoritative reversible integrity state. game_attempts.verified is the compatibility projection consumed by rankings and profiles.';
comment on table public.game_attempt_integrity_events is
  'Append-only audit ledger for integrity policy decisions; raw game attempts are never deleted by reassessment.';
comment on function public.game_attempt_integrity_decision(jsonb) is
  'Policy v2: precision alone and IP correlation alone cannot exclude an attempt; exclusion requires corroborating repeated interaction plus strong identity or repeated activation-gap evidence.';
