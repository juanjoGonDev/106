create table if not exists public.game_integrity_bans (
  id bigint generated always as identity primary key,
  scope text not null check (scope in ('account', 'device', 'ip')),
  account_id uuid,
  device_hash text,
  ip_hash text,
  reason text not null,
  source_attempt_id uuid not null references public.game_attempts(id) on delete cascade,
  triggered_at timestamptz not null,
  expires_at timestamptz not null,
  policy_version integer not null default 3 check (policy_version > 0),
  evidence jsonb not null default '{}'::jsonb,
  constraint game_integrity_bans_expiry_check check (expires_at > triggered_at),
  constraint game_integrity_bans_target_check check (
    (scope = 'account' and account_id is not null and device_hash is null and ip_hash is null)
    or (scope = 'device' and account_id is null and device_hash is not null and ip_hash is null)
    or (scope = 'ip' and account_id is null and device_hash is null and ip_hash is not null)
  )
);

create unique index if not exists game_integrity_bans_source_scope_key
  on public.game_integrity_bans(source_attempt_id, scope);
create index if not exists game_integrity_bans_account_active_idx
  on public.game_integrity_bans(account_id, expires_at desc)
  where scope = 'account';
create index if not exists game_integrity_bans_device_active_idx
  on public.game_integrity_bans(device_hash, expires_at desc)
  where scope = 'device';
create index if not exists game_integrity_bans_ip_active_idx
  on public.game_integrity_bans(ip_hash, expires_at desc)
  where scope = 'ip';

alter table public.game_integrity_bans enable row level security;
revoke all on table public.game_integrity_bans from public, anon, authenticated;
revoke all on table public.game_integrity_bans from service_role;
grant select, insert on table public.game_integrity_bans to service_role;
grant usage, select on sequence public.game_integrity_bans_id_seq to service_role;

create table if not exists public.game_achievement_point_policy (
  achievement_code text primary key,
  points integer not null check (points > 0),
  policy_version integer not null default 3 check (policy_version > 0)
);

alter table public.game_achievement_point_policy enable row level security;
revoke all on table public.game_achievement_point_policy from public, anon, authenticated;
grant select on table public.game_achievement_point_policy to service_role;

insert into public.game_achievement_point_policy(achievement_code, points, policy_version)
values
  ('perfect_total_1', 100, 3),
  ('perfect_total_3', 150, 3),
  ('perfect_total_5', 225, 3),
  ('perfect_total_10', 350, 3),
  ('perfect_total_25', 650, 3),
  ('perfect_total_50', 1000, 3),
  ('perfect_total_100', 1600, 3),
  ('perfect_average', 300, 3)
on conflict (achievement_code) do update
set points = excluded.points,
    policy_version = excluded.policy_version;

create or replace function public.apply_game_achievement_point_policy()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_points integer;
begin
  select policy.points into v_points
  from public.game_achievement_point_policy policy
  where policy.achievement_code = new.achievement_code;

  if found then
    new.points := v_points;
  end if;
  return new;
end;
$$;

drop trigger if exists game_player_achievement_points on public.game_player_achievements;
create trigger game_player_achievement_points
before insert or update of achievement_code, points on public.game_player_achievements
for each row execute function public.apply_game_achievement_point_policy();

update public.game_player_achievements achievement
set points = policy.points
from public.game_achievement_point_policy policy
where policy.achievement_code = achievement.achievement_code
  and achievement.points is distinct from policy.points;

create or replace function public.issue_game_integrity_ban(
  p_scope text,
  p_account_id uuid,
  p_device_hash text,
  p_ip_hash text,
  p_reason text,
  p_source_attempt_id uuid,
  p_triggered_at timestamptz,
  p_evidence jsonb default '{}'::jsonb
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_scope text := lower(trim(coalesce(p_scope, '')));
  v_triggered_at timestamptz := coalesce(p_triggered_at, clock_timestamp());
  v_inserted integer := 0;
begin
  if v_scope not in ('account', 'device', 'ip') or p_source_attempt_id is null then
    return false;
  end if;
  if v_scope = 'account' and p_account_id is null then return false; end if;
  if v_scope = 'device' and coalesce(p_device_hash, '') = '' then return false; end if;
  if v_scope = 'ip' and coalesce(p_ip_hash, '') = '' then return false; end if;

  insert into public.game_integrity_bans(
    scope,
    account_id,
    device_hash,
    ip_hash,
    reason,
    source_attempt_id,
    triggered_at,
    expires_at,
    policy_version,
    evidence
  ) values (
    v_scope,
    case when v_scope = 'account' then public.daily_game_account_id(p_account_id) else null end,
    case when v_scope = 'device' then p_device_hash else null end,
    case when v_scope = 'ip' then p_ip_hash else null end,
    left(coalesce(nullif(trim(p_reason), ''), 'confirmed_malicious_session'), 80),
    p_source_attempt_id,
    v_triggered_at,
    v_triggered_at + interval '48 hours',
    3,
    coalesce(p_evidence, '{}'::jsonb)
  )
  on conflict (source_attempt_id, scope) do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted > 0;
end;
$$;

create or replace function public.get_game_active_integrity_ban_for_account(
  p_account_id uuid,
  p_device_hash text,
  p_ip_hash text,
  p_at timestamptz default clock_timestamp()
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_account_id uuid := public.daily_game_account_id(p_account_id);
  v_ban public.game_integrity_bans%rowtype;
  v_now timestamptz := coalesce(p_at, clock_timestamp());
begin
  select ban.* into v_ban
  from public.game_integrity_bans ban
  where ban.expires_at > v_now
    and (
      (ban.scope = 'account' and v_account_id is not null and ban.account_id = v_account_id)
      or (ban.scope = 'device' and coalesce(p_device_hash, '') <> '' and ban.device_hash = p_device_hash)
      or (ban.scope = 'ip' and coalesce(p_ip_hash, '') <> '' and ban.ip_hash = p_ip_hash)
    )
  order by
    case ban.scope when 'account' then 1 when 'device' then 2 else 3 end,
    ban.expires_at desc,
    ban.id desc
  limit 1;

  if not found then
    return jsonb_build_object('banned', false);
  end if;

  return jsonb_build_object(
    'banned', true,
    'scope', v_ban.scope,
    'expiresAt', v_ban.expires_at,
    'retryAfterSeconds', greatest(1, ceil(extract(epoch from (v_ban.expires_at - v_now)))::integer),
    'policyVersion', v_ban.policy_version
  );
end;
$$;

create or replace function public.get_game_active_integrity_ban(
  p_nick_key text,
  p_device_hash text,
  p_ip_hash text,
  p_at timestamptz default clock_timestamp()
) returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.get_game_active_integrity_ban_for_account(
    public.game_account_id_for_nick(p_nick_key),
    p_device_hash,
    p_ip_hash,
    p_at
  );
$$;

create or replace function public.get_game_active_integrity_ban_by_token(
  p_account_token_hash text,
  p_device_hash text,
  p_ip_hash text,
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
  if coalesce(p_account_token_hash, '') ~ '^[a-f0-9]{64}$' then
    v_account_id := public.resolve_game_account_token(p_account_token_hash);
  end if;

  return public.get_game_active_integrity_ban_for_account(
    v_account_id,
    p_device_hash,
    p_ip_hash,
    p_at
  );
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
  v_window_start timestamptz;
  v_session_start timestamptz;
  v_same_device_near_perfect integer := 0;
  v_distinct_device_nicks integer := 0;
  v_distinct_device_accounts integer := 0;
  v_same_account_nicks integer := 0;
  v_same_ip_near_perfect integer := 0;
  v_same_ip_devices integer := 0;
  v_fingerprint_matches integer := 0;
  v_automation_shape_matches integer := 0;
  v_session_attempts integer := 0;
  v_session_near_perfect integer := 0;
  v_session_very_near integer := 0;
  v_session_ordinary integer := 0;
  v_session_fingerprint_matches integer := 0;
  v_session_automation_shape integer := 0;
  v_session_switches integer := 0;
  v_session_ip_devices integer := 0;
begin
  select attempt.* into v_anchor
  from public.game_attempts attempt
  where attempt.id = p_anchor_attempt_id;

  if not found then
    return jsonb_build_object('error', 'attempt_not_found');
  end if;

  v_anchor_account_id := public.daily_game_account_id(public.game_account_id_for_nick(v_anchor.nick_key));
  v_window_start := v_anchor.created_at - interval '24 hours';
  v_session_start := v_anchor.created_at - interval '2 hours';

  select
    count(*)::integer,
    count(distinct attempt.nick_key)::integer,
    count(distinct public.daily_game_account_id(public.game_account_id_for_nick(attempt.nick_key)))
      filter (where public.game_account_id_for_nick(attempt.nick_key) is not null)::integer
  into
    v_same_device_near_perfect,
    v_distinct_device_nicks,
    v_distinct_device_accounts
  from public.game_attempts attempt
  join public.game_attempt_integrity integrity on integrity.attempt_id = attempt.id
  where integrity.hard_valid = true
    and attempt.device_hash = v_anchor.device_hash
    and attempt.difference_ms <= 5
    and attempt.created_at between v_window_start and v_anchor.created_at;

  if v_anchor_account_id is not null then
    select count(distinct attempt.nick_key)::integer
    into v_same_account_nicks
    from public.game_attempts attempt
    join public.game_attempt_integrity integrity on integrity.attempt_id = attempt.id
    where integrity.hard_valid = true
      and public.daily_game_account_id(public.game_account_id_for_nick(attempt.nick_key)) = v_anchor_account_id
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

  select coalesce(max(grouped.total), 0)::integer
  into v_fingerprint_matches
  from (
    select public.game_attempt_interaction_fingerprint(attempt.client_signals) as fingerprint,
      count(*)::integer as total
    from public.game_attempts attempt
    join public.game_attempt_integrity integrity on integrity.attempt_id = attempt.id
    where integrity.hard_valid = true
      and attempt.device_hash = v_anchor.device_hash
      and attempt.difference_ms <= 5
      and attempt.created_at between v_window_start and v_anchor.created_at
      and public.game_attempt_interaction_fingerprint(attempt.client_signals) is not null
    group by public.game_attempt_interaction_fingerprint(attempt.client_signals)
  ) grouped;

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
    and coalesce(signal.telemetry->>'automaticFinish', 'false') <> 'true'
    and coalesce(signal.telemetry->>'pointerType', '') = 'mouse'
    and coalesce(signal.telemetry->>'userActivation', 'false') = 'false'
    and coalesce(signal.telemetry->>'pointerMoveCount', '') = '0'
    and coalesce(signal.telemetry->>'pointerTravelPx', '') = '0'
    and coalesce(signal.telemetry->>'pointerDwellMs', '') = '0';

  select
    count(*)::integer,
    count(*) filter (where attempt.difference_ms <= 5)::integer,
    count(*) filter (where attempt.difference_ms <= 2)::integer,
    count(*) filter (where attempt.difference_ms > 5)::integer
  into
    v_session_attempts,
    v_session_near_perfect,
    v_session_very_near,
    v_session_ordinary
  from public.game_attempts attempt
  join public.game_attempt_integrity integrity on integrity.attempt_id = attempt.id
  where integrity.hard_valid = true
    and attempt.created_at between v_session_start and v_anchor.created_at
    and (
      attempt.device_hash = v_anchor.device_hash
      or (
        v_anchor_account_id is not null
        and public.daily_game_account_id(public.game_account_id_for_nick(attempt.nick_key)) = v_anchor_account_id
      )
    );

  select coalesce(max(grouped.total), 0)::integer
  into v_session_fingerprint_matches
  from (
    select public.game_attempt_interaction_fingerprint(attempt.client_signals) as fingerprint,
      count(*)::integer as total
    from public.game_attempts attempt
    join public.game_attempt_integrity integrity on integrity.attempt_id = attempt.id
    where integrity.hard_valid = true
      and attempt.difference_ms <= 5
      and attempt.created_at between v_session_start and v_anchor.created_at
      and (
        attempt.device_hash = v_anchor.device_hash
        or (
          v_anchor_account_id is not null
          and public.daily_game_account_id(public.game_account_id_for_nick(attempt.nick_key)) = v_anchor_account_id
        )
      )
      and public.game_attempt_interaction_fingerprint(attempt.client_signals) is not null
    group by public.game_attempt_interaction_fingerprint(attempt.client_signals)
  ) grouped;

  select count(*)::integer
  into v_session_automation_shape
  from public.game_attempts attempt
  join public.game_attempt_integrity integrity on integrity.attempt_id = attempt.id
  cross join lateral (
    select public.game_attempt_client_telemetry(attempt.client_signals) as telemetry
  ) signal
  where integrity.hard_valid = true
    and attempt.difference_ms <= 5
    and attempt.created_at between v_session_start and v_anchor.created_at
    and (
      attempt.device_hash = v_anchor.device_hash
      or (
        v_anchor_account_id is not null
        and public.daily_game_account_id(public.game_account_id_for_nick(attempt.nick_key)) = v_anchor_account_id
      )
    )
    and coalesce(signal.telemetry->>'automaticFinish', 'false') <> 'true'
    and coalesce(signal.telemetry->>'pointerType', '') = 'mouse'
    and coalesce(signal.telemetry->>'userActivation', 'false') = 'false'
    and coalesce(signal.telemetry->>'pointerMoveCount', '') = '0'
    and coalesce(signal.telemetry->>'pointerTravelPx', '') = '0'
    and coalesce(signal.telemetry->>'pointerDwellMs', '') = '0';

  with session_sequence as (
    select attempt.id,
      attempt.created_at,
      attempt.difference_ms <= 5 as near_perfect
    from public.game_attempts attempt
    join public.game_attempt_integrity integrity on integrity.attempt_id = attempt.id
    where integrity.hard_valid = true
      and attempt.created_at between v_session_start and v_anchor.created_at
      and (
        attempt.device_hash = v_anchor.device_hash
        or (
          v_anchor_account_id is not null
          and public.daily_game_account_id(public.game_account_id_for_nick(attempt.nick_key)) = v_anchor_account_id
        )
      )
  ), transitions as (
    select near_perfect,
      lag(near_perfect) over(order by created_at, id) as previous_near_perfect
    from session_sequence
  )
  select count(*) filter (
    where previous_near_perfect is not null
      and previous_near_perfect is distinct from near_perfect
  )::integer
  into v_session_switches
  from transitions;

  select count(distinct attempt.device_hash)::integer
  into v_session_ip_devices
  from public.game_attempts attempt
  join public.game_attempt_integrity integrity on integrity.attempt_id = attempt.id
  where integrity.hard_valid = true
    and attempt.ip_hash = v_anchor.ip_hash
    and attempt.created_at between v_session_start and v_anchor.created_at;

  return jsonb_build_object(
    'anchorAttemptId', v_anchor.id,
    'anchorNearPerfect', v_anchor.difference_ms <= 5,
    'accountLinked', v_anchor_account_id is not null,
    'windowStart', v_window_start,
    'windowEnd', v_anchor.created_at,
    'sessionWindowStart', v_session_start,
    'sessionWindowEnd', v_anchor.created_at,
    'sameDeviceNearPerfect', v_same_device_near_perfect,
    'distinctDeviceNicks', v_distinct_device_nicks,
    'distinctDeviceAccounts', v_distinct_device_accounts,
    'sameAccountNicks', v_same_account_nicks,
    'sameIpNearPerfect', v_same_ip_near_perfect,
    'sameIpDevices', v_same_ip_devices,
    'fingerprintMatches', v_fingerprint_matches,
    'automationShapeMatches', v_automation_shape_matches,
    'sessionAttempts2h', v_session_attempts,
    'sessionNearPerfect2h', v_session_near_perfect,
    'sessionVeryNear2h', v_session_very_near,
    'sessionOrdinary2h', v_session_ordinary,
    'sessionFingerprintMatches2h', v_session_fingerprint_matches,
    'sessionAutomationShape2h', v_session_automation_shape,
    'sessionNearOrdinarySwitches2h', v_session_switches,
    'sessionIpDevices2h', v_session_ip_devices
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
  v_session_attempts integer := greatest(0, coalesce((p_evidence->>'sessionAttempts2h')::integer, 0));
  v_session_near integer := greatest(0, coalesce((p_evidence->>'sessionNearPerfect2h')::integer, 0));
  v_session_very_near integer := greatest(0, coalesce((p_evidence->>'sessionVeryNear2h')::integer, 0));
  v_session_ordinary integer := greatest(0, coalesce((p_evidence->>'sessionOrdinary2h')::integer, 0));
  v_session_fingerprint integer := greatest(0, coalesce((p_evidence->>'sessionFingerprintMatches2h')::integer, 0));
  v_session_automation integer := greatest(0, coalesce((p_evidence->>'sessionAutomationShape2h')::integer, 0));
  v_session_switches integer := greatest(0, coalesce((p_evidence->>'sessionNearOrdinarySwitches2h')::integer, 0));
  v_anchor_near boolean := coalesce((p_evidence->>'anchorNearPerfect')::boolean, false);
  v_score integer := 0;
  v_status text := 'eligible';
  v_reasons text[] := '{}'::text[];
  v_legacy_malicious boolean := false;
  v_session_automation_malicious boolean := false;
  v_session_alternation_malicious boolean := false;
  v_malicious boolean := false;
begin
  v_score := v_score + case
    when v_near >= 8 then 30
    when v_near >= 6 then 25
    when v_near >= 4 then 20
    when v_near >= 3 then 10
    else 0
  end;
  if v_near >= 3 then v_reasons := array_append(v_reasons, 'near_perfect_frequency'); end if;

  v_score := v_score + case
    when v_nicks >= 4 then 30
    when v_nicks >= 3 then 25
    when v_nicks >= 2 then 10
    else 0
  end;
  if v_nicks >= 2 then v_reasons := array_append(v_reasons, 'cross_nick_same_device'); end if;

  v_score := v_score + case
    when v_fingerprint >= 4 then 25
    when v_fingerprint >= 3 then 20
    when v_fingerprint >= 2 then 10
    else 0
  end;
  if v_fingerprint >= 2 then v_reasons := array_append(v_reasons, 'repeated_interaction_pattern'); end if;

  v_score := v_score + case
    when v_automation_shape >= 4 then 30
    when v_automation_shape >= 3 then 15
    else 0
  end;
  if v_automation_shape >= 3 then v_reasons := array_append(v_reasons, 'repeated_zero_motion_activation_gap'); end if;

  if v_accounts >= 2 or v_account_nicks >= 3 then
    v_score := v_score + 5;
    v_reasons := array_append(v_reasons, 'multi_identity_context');
  end if;

  if v_ip_near >= 6 and v_ip_devices >= 3 then
    v_score := v_score + 5;
    v_reasons := array_append(v_reasons, 'shared_ip_context');
  end if;

  v_score := v_score + case
    when v_session_near >= 6 then 25
    when v_session_near >= 4 then 20
    when v_session_near >= 3 then 10
    else 0
  end;
  if v_session_near >= 3 then v_reasons := array_append(v_reasons, 'two_hour_near_perfect_frequency'); end if;

  v_score := v_score + case
    when v_session_very_near >= 4 then 20
    when v_session_very_near >= 3 then 10
    else 0
  end;
  if v_session_very_near >= 3 then v_reasons := array_append(v_reasons, 'two_hour_very_near_frequency'); end if;

  v_score := v_score + case
    when v_session_fingerprint >= 3 then 20
    when v_session_fingerprint >= 2 then 10
    else 0
  end;
  if v_session_fingerprint >= 2 then v_reasons := array_append(v_reasons, 'two_hour_repeated_interaction'); end if;

  v_score := v_score + case
    when v_session_automation >= 3 then 25
    when v_session_automation >= 2 then 15
    else 0
  end;
  if v_session_automation >= 2 then v_reasons := array_append(v_reasons, 'two_hour_mouse_activation_gap'); end if;

  if v_session_switches >= 5 and v_session_near >= 3 and v_session_ordinary >= 3 then
    v_score := v_score + 20;
    v_reasons := array_append(v_reasons, 'two_hour_alternating_pattern');
  elsif v_session_switches >= 3 and v_session_near >= 2 and v_session_ordinary >= 2 then
    v_score := v_score + 10;
    v_reasons := array_append(v_reasons, 'two_hour_mixed_pattern');
  end if;

  v_score := least(100, v_score);

  v_legacy_malicious := v_near >= 4
    and v_fingerprint >= 3
    and (v_nicks >= 3 or v_automation_shape >= 4);

  v_session_automation_malicious := v_session_near >= 3
    and v_session_automation >= 3
    and v_session_fingerprint >= 2;

  v_session_alternation_malicious := v_session_attempts >= 5
    and v_session_near >= 3
    and v_session_ordinary >= 2
    and v_session_switches >= 3
    and v_session_fingerprint >= 3;

  v_malicious := v_score >= 65
    and (v_legacy_malicious or v_session_automation_malicious or v_session_alternation_malicious);

  if v_malicious then
    v_reasons := array_append(v_reasons, 'confirmed_malicious_session');
  end if;

  if v_malicious and v_anchor_near then
    v_status := 'excluded';
  elsif v_score >= 35 or v_malicious then
    v_status := 'watch';
  end if;

  return jsonb_build_object(
    'status', v_status,
    'riskScore', v_score,
    'reasons', to_jsonb(v_reasons),
    'malicious', v_malicious,
    'policyVersion', 3
  );
end;
$$;

create or replace function public.reassess_game_integrity_cluster(p_anchor_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_anchor public.game_attempts%rowtype;
  v_anchor_integrity public.game_attempt_integrity%rowtype;
  v_anchor_account_id uuid;
  v_evidence jsonb;
  v_decision jsonb;
  v_decision_status text := 'eligible';
  v_decision_score integer := 0;
  v_decision_reasons text[] := '{}'::text[];
  v_malicious boolean := false;
  v_target record;
  v_target_account_id uuid;
  v_target_in_malicious_window boolean;
  v_next_status text;
  v_next_score integer;
  v_next_reasons text[];
  v_should_verify boolean;
  v_changed_attempts uuid[] := '{}'::uuid[];
  v_state_changes integer := 0;
  v_projection_changes integer := 0;
  v_bans_created integer := 0;
  v_active_ban jsonb;
begin
  insert into public.game_attempt_integrity(
    attempt_id, hard_valid, status, risk_score, risk_reasons, evidence, policy_version, evaluated_at
  )
  select attempt.id,
    public.game_attempt_hard_valid(attempt.verified, attempt.verification_reasons),
    case when public.game_attempt_hard_valid(attempt.verified, attempt.verification_reasons) then 'eligible' else 'excluded' end,
    0,
    case when public.game_attempt_hard_valid(attempt.verified, attempt.verification_reasons)
      then '{}'::text[] else coalesce(attempt.verification_reasons, '{}'::text[]) end,
    jsonb_build_object('source', 'late_seed'),
    2,
    clock_timestamp()
  from public.game_attempts attempt
  where attempt.id = p_anchor_attempt_id
  on conflict (attempt_id) do nothing;

  select attempt.* into v_anchor
  from public.game_attempts attempt
  where attempt.id = p_anchor_attempt_id;
  if not found then return jsonb_build_object('error', 'attempt_not_found'); end if;

  v_anchor_account_id := public.daily_game_account_id(public.game_account_id_for_nick(v_anchor.nick_key));

  if v_anchor_account_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('integrity-account:' || v_anchor_account_id::text, 106));
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended('integrity-device:' || coalesce(v_anchor.device_hash, v_anchor.id::text), 106)
  );

  select integrity.* into v_anchor_integrity
  from public.game_attempt_integrity integrity
  where integrity.attempt_id = v_anchor.id;

  if not v_anchor_integrity.hard_valid then
    if v_anchor.verified then
      perform set_config('minuto106.integrity_reconcile', 'on', true);
      update public.game_attempts set verified = false where id = v_anchor.id;
      perform set_config('minuto106.integrity_reconcile', 'off', true);
      v_changed_attempts := array_append(v_changed_attempts, v_anchor.id);
      v_projection_changes := 1;
    end if;

    update public.game_attempt_integrity
    set status = 'excluded',
        policy_version = 3,
        evaluated_at = clock_timestamp()
    where attempt_id = v_anchor.id;

    if v_projection_changes > 0
       and coalesce(current_setting('minuto106.integrity_bulk', true), '') <> 'on' then
      perform public.reconcile_game_integrity_attempts(v_changed_attempts);
    end if;

    return jsonb_build_object(
      'status', 'excluded',
      'riskScore', v_anchor_integrity.risk_score,
      'hardValid', false,
      'malicious', false,
      'projectionChanges', v_projection_changes,
      'policyVersion', 3
    );
  end if;

  v_evidence := public.game_attempt_integrity_evidence(v_anchor.id);
  v_decision := public.game_attempt_integrity_decision(v_evidence);
  v_decision_status := coalesce(v_decision->>'status', 'eligible');
  v_decision_score := greatest(0, least(100, coalesce((v_decision->>'riskScore')::integer, 0)));
  v_malicious := coalesce((v_decision->>'malicious')::boolean, false);
  select coalesce(array_agg(reason), '{}'::text[])
  into v_decision_reasons
  from jsonb_array_elements_text(coalesce(v_decision->'reasons', '[]'::jsonb)) reason;

  perform set_config('minuto106.integrity_reconcile', 'on', true);

  for v_target in
    select attempt.id,
      attempt.nick_key,
      attempt.device_hash,
      attempt.difference_ms,
      attempt.created_at,
      attempt.verified,
      integrity.hard_valid,
      integrity.status,
      integrity.risk_score,
      integrity.risk_reasons,
      integrity.policy_version
    from public.game_attempts attempt
    join public.game_attempt_integrity integrity on integrity.attempt_id = attempt.id
    where integrity.hard_valid = true
      and (
        attempt.id = v_anchor.id
        or (
          v_malicious
          and attempt.difference_ms <= 5
          and attempt.created_at between v_anchor.created_at - interval '2 hours' and v_anchor.created_at
          and (
            attempt.device_hash = v_anchor.device_hash
            or (
              v_anchor_account_id is not null
              and public.daily_game_account_id(public.game_account_id_for_nick(attempt.nick_key)) = v_anchor_account_id
            )
          )
        )
        or (
          not v_malicious
          and v_anchor.difference_ms <= 5
          and attempt.device_hash = v_anchor.device_hash
          and attempt.difference_ms <= 5
          and attempt.created_at between v_anchor.created_at - interval '24 hours' and v_anchor.created_at
        )
      )
    order by attempt.created_at, attempt.id
  loop
    v_target_account_id := public.daily_game_account_id(public.game_account_id_for_nick(v_target.nick_key));
    v_target_in_malicious_window := v_malicious
      and v_target.difference_ms <= 5
      and v_target.created_at between v_anchor.created_at - interval '2 hours' and v_anchor.created_at
      and (
        v_target.device_hash = v_anchor.device_hash
        or (v_anchor_account_id is not null and v_target_account_id = v_anchor_account_id)
      );

    v_next_status := case
      when v_target.status = 'excluded' then 'excluded'
      when v_target_in_malicious_window then 'excluded'
      when v_target.id = v_anchor.id then v_decision_status
      when not v_malicious and v_decision_status = 'watch' then 'watch'
      else v_target.status
    end;
    v_next_score := greatest(v_target.risk_score, v_decision_score);

    select coalesce(array_agg(distinct reason order by reason), '{}'::text[])
    into v_next_reasons
    from unnest(
      coalesce(v_target.risk_reasons, '{}'::text[])
      || v_decision_reasons
      || case when v_target_in_malicious_window then array['retroactive_two_hour_revocation']::text[] else '{}'::text[] end
    ) reason;

    v_should_verify := v_target.hard_valid and v_next_status <> 'excluded';

    if v_target.status is distinct from v_next_status
       or v_target.risk_score is distinct from v_next_score
       or v_target.risk_reasons is distinct from v_next_reasons
       or v_target.policy_version is distinct from 3
       or v_target.verified is distinct from v_should_verify then
      insert into public.game_attempt_integrity_events(
        attempt_id, previous_status, next_status, previous_score, next_score,
        reasons, evidence, policy_version
      ) values (
        v_target.id,
        v_target.status,
        v_next_status,
        v_target.risk_score,
        v_next_score,
        v_next_reasons,
        v_evidence || jsonb_build_object('decision', v_decision),
        3
      );

      update public.game_attempt_integrity
      set status = v_next_status,
          risk_score = v_next_score,
          risk_reasons = v_next_reasons,
          evidence = v_evidence || jsonb_build_object('decision', v_decision),
          policy_version = 3,
          evaluated_at = clock_timestamp()
      where attempt_id = v_target.id;
      v_state_changes := v_state_changes + 1;

      if v_target.verified is distinct from v_should_verify then
        update public.game_attempts set verified = v_should_verify where id = v_target.id;
        v_changed_attempts := array_append(v_changed_attempts, v_target.id);
        v_projection_changes := v_projection_changes + 1;
      end if;
    end if;
  end loop;

  perform set_config('minuto106.integrity_reconcile', 'off', true);

  if v_malicious then
    if v_anchor_account_id is not null and public.issue_game_integrity_ban(
      'account', v_anchor_account_id, null, null, 'confirmed_malicious_session',
      v_anchor.id, v_anchor.created_at, v_evidence || jsonb_build_object('decision', v_decision)
    ) then
      v_bans_created := v_bans_created + 1;
    end if;

    if public.issue_game_integrity_ban(
      'device', null, v_anchor.device_hash, null, 'confirmed_malicious_session',
      v_anchor.id, v_anchor.created_at, v_evidence || jsonb_build_object('decision', v_decision)
    ) then
      v_bans_created := v_bans_created + 1;
    end if;

    if coalesce((v_evidence->>'sessionIpDevices2h')::integer, 0) <= 1
       and public.issue_game_integrity_ban(
        'ip', null, null, v_anchor.ip_hash, 'confirmed_malicious_session_low_sharing_ip',
        v_anchor.id, v_anchor.created_at, v_evidence || jsonb_build_object('decision', v_decision)
      ) then
      v_bans_created := v_bans_created + 1;
    end if;
  end if;

  if v_projection_changes > 0
     and coalesce(current_setting('minuto106.integrity_bulk', true), '') <> 'on' then
    perform public.reconcile_game_integrity_attempts(v_changed_attempts);
  end if;

  select integrity.* into v_anchor_integrity
  from public.game_attempt_integrity integrity
  where integrity.attempt_id = v_anchor.id;
  v_active_ban := public.get_game_active_integrity_ban_for_account(
    v_anchor_account_id,
    v_anchor.device_hash,
    v_anchor.ip_hash,
    v_anchor.created_at
  );

  return jsonb_build_object(
    'status', v_anchor_integrity.status,
    'riskScore', v_anchor_integrity.risk_score,
    'hardValid', v_anchor_integrity.hard_valid,
    'reasons', to_jsonb(v_anchor_integrity.risk_reasons),
    'malicious', v_malicious,
    'bansCreated', v_bans_created,
    'restrictedUntil', case when coalesce((v_active_ban->>'banned')::boolean, false) then v_active_ban->>'expiresAt' else null end,
    'stateChanges', v_state_changes,
    'projectionChanges', v_projection_changes,
    'policyVersion', 3
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
  v_ban jsonb;
  v_result jsonb;
  v_challenge_id uuid;
begin
  v_ban := public.get_game_active_integrity_ban(p_nick_key, p_device_hash, p_ip_hash);
  if coalesce((v_ban->>'banned')::boolean, false) then
    return jsonb_build_object('error', 'integrity_banned') || (v_ban - 'banned');
  end if;

  v_result := public.start_game_challenge(
    p_nick,
    p_nick_key,
    p_team,
    p_device_hash,
    p_ip_hash,
    p_referral_code,
    p_league_code
  );
  if v_result ? 'error' then return v_result; end if;

  v_challenge_id := (v_result->>'challengeId')::uuid;
  update public.game_challenges
  set interaction_mode = 'press',
      min_hold_ms = 0,
      max_hold_ms = 0
  where id = v_challenge_id;

  v_result := jsonb_set(v_result, '{interaction,mode}', to_jsonb('press'::text), true);
  v_result := v_result #- '{interaction,keyboardKey}' #- '{interaction,minHoldMs}' #- '{interaction,maxHoldMs}';
  return v_result;
end;
$$;

create or replace function public.finish_game_attempt_pointer_only(
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
  v_transport_delta_ms integer;
  v_is_timeout boolean := p_client_elapsed_ms = 30000
    and coalesce(p_client_signals->>'automaticFinish', 'false') = 'true';
  v_pointer_type text := case
    when coalesce(p_client_signals->>'pointerType', '') in ('mouse', 'touch', 'pen')
      then p_client_signals->>'pointerType'
    else 'unknown'
  end;
  v_authoritative_signals jsonb;
  v_result jsonb;
  v_attempt_id uuid;
  v_effective_verified boolean;
  v_integrity_result jsonb;
  v_ban jsonb;
begin
  select * into v_challenge
  from public.game_challenges
  where id = p_challenge_id
  for update;

  if not found then return jsonb_build_object('error', 'challenge_not_found'); end if;
  if v_challenge.consumed_at is not null then return jsonb_build_object('error', 'challenge_used'); end if;
  if v_challenge.prepared_at is not null and v_challenge.activated_at is null then
    return jsonb_build_object('error', 'challenge_not_activated');
  end if;
  if v_challenge.device_hash <> p_device_hash then return jsonb_build_object('error', 'device_mismatch'); end if;
  if v_challenge.started_at is null then return jsonb_build_object('error', 'challenge_not_activated'); end if;

  v_ban := public.get_game_active_integrity_ban(v_challenge.nick_key, p_device_hash, p_ip_hash, v_now);
  if coalesce((v_ban->>'banned')::boolean, false) then
    return jsonb_build_object('error', 'integrity_banned') || (v_ban - 'banned');
  end if;

  if p_client_elapsed_ms is null or p_client_elapsed_ms not between 2000 and 30000 then
    update public.game_challenges set consumed_at = v_now where id = p_challenge_id;
    return jsonb_build_object('error', 'invalid_timing');
  end if;

  v_server_elapsed_ms := round(extract(epoch from (v_now - v_challenge.started_at)) * 1000)::integer;
  v_transport_delta_ms := v_server_elapsed_ms - p_client_elapsed_ms;

  if v_is_timeout then
    if v_server_elapsed_ms not between 29250 and 33000 then
      update public.game_challenges set consumed_at = v_now where id = p_challenge_id;
      return jsonb_build_object('error', 'timing_mismatch', 'serverElapsedMs', v_server_elapsed_ms, 'transportDeltaMs', v_transport_delta_ms);
    end if;
  elsif v_transport_delta_ms not between -750 and 2500 then
    update public.game_challenges set consumed_at = v_now where id = p_challenge_id;
    return jsonb_build_object('error', 'timing_mismatch', 'serverElapsedMs', v_server_elapsed_ms, 'transportDeltaMs', v_transport_delta_ms);
  end if;

  v_authoritative_signals := jsonb_build_object(
    'trustedStart', true,
    'trustedFinish', true,
    'timerConcealed', true,
    'visibilityChanges', 0,
    'focusLosses', 0,
    'interactionMode', v_challenge.interaction_mode,
    'controlNonce', v_challenge.interaction_nonce::text,
    'finishEvent', case when v_is_timeout then '' else 'pointerdown' end,
    'pointerTrusted', true,
    'userActivation', true,
    'automationDetected', false,
    'pointerType', case when v_is_timeout then 'unknown' else v_pointer_type end,
    'pointerXPercent', v_challenge.target_x_percent,
    'pointerYPercent', v_challenge.target_y_percent,
    'pointerMoveCount', case when v_is_timeout then 0 else 1 end,
    'pointerTravelPx', case when v_is_timeout then 0 else 1 end,
    'pointerDwellMs', 0,
    'pressureMax', 0,
    'holdDurationMs', 0,
    'samePointer', true,
    'automaticFinish', v_is_timeout,
    'clientTelemetry', coalesce(p_client_signals, '{}'::jsonb)
  );

  v_result := public.finish_game_attempt(
    p_challenge_id,
    p_client_elapsed_ms,
    p_device_hash,
    p_ip_hash,
    v_authoritative_signals
  );
  if v_result ? 'error' then return v_result; end if;

  v_attempt_id := nullif(v_result #>> '{attempt,id}', '')::uuid;
  if v_attempt_id is not null then
    v_integrity_result := public.reassess_game_integrity_cluster(v_attempt_id);
    select attempt.verified into v_effective_verified
    from public.game_attempts attempt
    where attempt.id = v_attempt_id;
    v_result := jsonb_set(v_result, '{attempt,verified}', to_jsonb(coalesce(v_effective_verified, false)), true);
    if coalesce((v_integrity_result->>'malicious')::boolean, false) then
      v_result := jsonb_set(
        v_result,
        '{attempt,restrictedUntil}',
        to_jsonb(v_integrity_result->>'restrictedUntil'),
        true
      );
    end if;
  end if;

  v_result := jsonb_set(v_result, '{attempt,serverElapsedMs}', to_jsonb(v_server_elapsed_ms), true);
  v_result := jsonb_set(v_result, '{attempt,transportDeltaMs}', to_jsonb(v_transport_delta_ms), true);
  return v_result;
end;
$$;

create or replace function public.rebuild_game_attempt_integrity(p_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_anchor_id uuid;
  v_account_id uuid;
  v_date date;
  v_nick_key text;
  v_pending integer := 0;
  v_reassessed integer := 0;
  v_verified_changes integer := 0;
  v_reassess_result jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('minuto106:integrity-policy-v3', 106));

  insert into public.game_attempt_integrity(
    attempt_id, hard_valid, status, risk_score, risk_reasons, evidence, policy_version, evaluated_at
  )
  select attempt.id,
    public.game_attempt_hard_valid(attempt.verified, attempt.verification_reasons),
    case when public.game_attempt_hard_valid(attempt.verified, attempt.verification_reasons) then 'eligible' else 'excluded' end,
    0,
    case when public.game_attempt_hard_valid(attempt.verified, attempt.verification_reasons)
      then '{}'::text[] else coalesce(attempt.verification_reasons, '{}'::text[]) end,
    jsonb_build_object('source', 'policy_v3_seed'),
    2,
    clock_timestamp()
  from public.game_attempts attempt
  on conflict (attempt_id) do nothing;

  select count(*)::integer into v_pending
  from public.game_attempt_integrity integrity
  where integrity.policy_version < 3;

  if not p_force and v_pending = 0 then
    return jsonb_build_object(
      'policyVersion', 3,
      'reassessed', 0,
      'verifiedChanges', 0,
      'alreadyCurrent', true
    );
  end if;

  perform set_config('minuto106.integrity_bulk', 'on', true);
  perform set_config('minuto106.integrity_reconcile', 'on', true);

  insert into public.game_attempt_integrity_events(
    attempt_id, previous_status, next_status, previous_score, next_score,
    reasons, evidence, policy_version
  )
  select integrity.attempt_id,
    integrity.status,
    case when integrity.hard_valid then 'eligible' else 'excluded' end,
    integrity.risk_score,
    0,
    case when integrity.hard_valid then '{}'::text[] else integrity.risk_reasons end,
    jsonb_build_object('source', 'policy_v3_rebuild_reset'),
    3
  from public.game_attempt_integrity integrity
  where p_force or integrity.policy_version < 3;

  update public.game_attempt_integrity integrity
  set status = case when integrity.hard_valid then 'eligible' else 'excluded' end,
      risk_score = 0,
      risk_reasons = case when integrity.hard_valid then '{}'::text[] else integrity.risk_reasons end,
      evidence = jsonb_build_object('source', 'policy_v3_rebuild_reset'),
      policy_version = 3,
      evaluated_at = clock_timestamp()
  where p_force or integrity.policy_version < 3;

  with changed as (
    update public.game_attempts attempt
    set verified = integrity.hard_valid
    from public.game_attempt_integrity integrity
    where integrity.attempt_id = attempt.id
      and attempt.verified is distinct from integrity.hard_valid
    returning attempt.id
  )
  select count(*)::integer into v_verified_changes from changed;

  perform set_config('minuto106.integrity_reconcile', 'off', true);

  for v_anchor_id in
    select attempt.id
    from public.game_attempts attempt
    join public.game_attempt_integrity integrity on integrity.attempt_id = attempt.id
    where integrity.hard_valid = true
    order by attempt.created_at, attempt.id
  loop
    v_reassess_result := public.reassess_game_integrity_cluster(v_anchor_id);
    v_verified_changes := v_verified_changes
      + coalesce((v_reassess_result->>'projectionChanges')::integer, 0);
    v_reassessed := v_reassessed + 1;
  end loop;

  for v_account_id in
    select distinct public.daily_game_account_id(account_player.account_id)
    from public.game_account_players account_player
    where account_player.account_id is not null
  loop
    perform public.reconcile_game_account_referral(v_account_id);
  end loop;

  for v_date in
    select distinct public.game_server_day(attempt.created_at)
    from public.game_attempts attempt
    where attempt.league_id is null
      and public.game_server_day(attempt.created_at) < public.game_server_day(clock_timestamp())
    order by 1
  loop
    perform public.reconcile_game_trophies_for_date(v_date);
  end loop;

  perform public.sync_game_league_trophies();
  perform set_config('minuto106.integrity_bulk', 'off', true);

  for v_nick_key in
    select player.nick_key from public.game_players player order by player.nick_key
  loop
    perform public.rebuild_game_player_achievements(v_nick_key);
  end loop;

  return jsonb_build_object(
    'policyVersion', 3,
    'reassessed', v_reassessed,
    'verifiedChanges', v_verified_changes,
    'alreadyCurrent', false
  );
end;
$$;

revoke all on function public.apply_game_achievement_point_policy() from public, anon, authenticated;
revoke all on function public.issue_game_integrity_ban(text, uuid, text, text, text, uuid, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function public.get_game_active_integrity_ban_for_account(uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.get_game_active_integrity_ban(text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.get_game_active_integrity_ban_by_token(text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.game_attempt_integrity_evidence(uuid) from public, anon, authenticated;
revoke all on function public.game_attempt_integrity_decision(jsonb) from public, anon, authenticated;
revoke all on function public.reassess_game_integrity_cluster(uuid) from public, anon, authenticated;
revoke all on function public.start_game_challenge_pointer_only(text, text, text, text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.finish_game_attempt_pointer_only(uuid, integer, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.rebuild_game_attempt_integrity(boolean) from public, anon, authenticated;

revoke all on function public.issue_game_integrity_ban(text, uuid, text, text, text, uuid, timestamptz, jsonb) from service_role;
grant execute on function public.get_game_active_integrity_ban_for_account(uuid, text, text, timestamptz) to service_role;
grant execute on function public.get_game_active_integrity_ban(text, text, text, timestamptz) to service_role;
grant execute on function public.get_game_active_integrity_ban_by_token(text, text, text, timestamptz) to service_role;
grant execute on function public.game_attempt_integrity_evidence(uuid) to service_role;
grant execute on function public.game_attempt_integrity_decision(jsonb) to service_role;
grant execute on function public.reassess_game_integrity_cluster(uuid) to service_role;
grant execute on function public.start_game_challenge_pointer_only(text, text, text, text, text, uuid, text) to service_role;
grant execute on function public.finish_game_attempt_pointer_only(uuid, integer, text, text, jsonb) to service_role;
grant execute on function public.rebuild_game_attempt_integrity(boolean) to service_role;

comment on table public.game_integrity_bans is
  'Append-only 48-hour integrity restriction ledger. Account/device are strong scopes; IP is issued only for low-sharing confirmed malicious sessions.';
comment on function public.game_attempt_integrity_decision(jsonb) is
  'Policy v3: a two-hour same-account/device sequence detects non-consecutive assisted attempts; precision or IP alone never convicts.';
comment on function public.reassess_game_integrity_cluster(uuid) is
  'Policy-v3 reassessment revokes only suspicious near-perfect results in the two-hour strong-identity window, creates bounded bans, and reuses canonical reward reconciliation.';
comment on function public.get_game_active_integrity_ban_by_token(text, text, text, timestamptz) is
  'Private preflight lookup used before expensive human verification; returns only scope/expiry metadata, never internal evidence.';

-- One-time forward backfill. Supabase applies this migration once; later requests only
-- reassess the newly finished bounded session instead of rescanning historical data.
select public.rebuild_game_attempt_integrity(true);
