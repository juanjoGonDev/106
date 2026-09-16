create table if not exists public.game_admin_attempt_actions (
  id bigint generated always as identity primary key,
  attempt_id uuid not null references public.game_attempts(id) on delete restrict,
  action text not null check (action in ('invalidate', 'restore')),
  reason text not null check (char_length(reason) between 3 and 500),
  created_by_session_id uuid not null references public.game_admin_sessions(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists game_admin_attempt_actions_attempt_idx
  on public.game_admin_attempt_actions(attempt_id, created_at desc, id desc);

alter table public.game_admin_attempt_actions enable row level security;
revoke all on table public.game_admin_attempt_actions from public, anon, authenticated, service_role;
grant select on table public.game_admin_attempt_actions to service_role;

alter table public.game_admin_audit_events
  drop constraint if exists game_admin_audit_events_action_check;
alter table public.game_admin_audit_events
  add constraint game_admin_audit_events_action_check
  check (action in ('ban', 'revoke', 'invalidate_attempt', 'restore_attempt'));

alter table public.game_admin_audit_events
  drop constraint if exists game_admin_audit_events_target_scope_check;
alter table public.game_admin_audit_events
  add constraint game_admin_audit_events_target_scope_check
  check (target_scope in ('account', 'nick', 'ip', 'attempt'));

create or replace function public.zadmin_create_session(
  p_token_hash text,
  p_ip_hash text,
  p_device_hash text,
  p_at timestamptz default clock_timestamp()
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := coalesce(p_at, clock_timestamp());
  v_session public.game_admin_sessions%rowtype;
begin
  if coalesce(p_token_hash, '') !~ '^[a-f0-9]{64}$'
     or coalesce(p_ip_hash, '') !~ '^[a-f0-9]{64}$'
     or coalesce(p_device_hash, '') !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('error', 'invalid_session');
  end if;

  insert into public.game_admin_sessions(
    token_hash, ip_hash, device_hash, created_at, expires_at, last_seen_at
  ) values (
    p_token_hash, p_ip_hash, p_device_hash, v_now, v_now + interval '12 hours', v_now
  ) returning * into v_session;

  return jsonb_build_object(
    'sessionId', v_session.id,
    'expiresAt', v_session.expires_at
  );
end;
$$;

create or replace function public.zadmin_validate_session(
  p_token_hash text,
  p_ip_hash text,
  p_device_hash text,
  p_at timestamptz default clock_timestamp()
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.game_admin_sessions%rowtype;
  v_now timestamptz := coalesce(p_at, clock_timestamp());
begin
  if coalesce(p_token_hash, '') !~ '^[a-f0-9]{64}$'
     or coalesce(p_ip_hash, '') !~ '^[a-f0-9]{64}$'
     or coalesce(p_device_hash, '') !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('valid', false);
  end if;

  update public.game_admin_sessions
  set last_seen_at = v_now,
      expires_at = greatest(expires_at, v_now + interval '12 hours')
  where token_hash = p_token_hash
    and ip_hash = p_ip_hash
    and device_hash = p_device_hash
    and revoked_at is null
    and expires_at > v_now
  returning * into v_session;

  if not found then return jsonb_build_object('valid', false); end if;
  return jsonb_build_object(
    'valid', true,
    'sessionId', v_session.id,
    'expiresAt', v_session.expires_at
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
  v_conviction_score integer := 0;
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

  v_session_alternation_malicious := v_session_attempts >= 5
    and v_session_near >= 3
    and v_session_ordinary >= 2
    and v_session_switches >= 3
    and v_session_fingerprint >= 3;

  if v_session_alternation_malicious then
    v_score := v_score + 10;
    v_reasons := array_append(v_reasons, 'two_hour_corroborated_alternation');
  end if;

  -- Preserve the existing automatic-conviction boundary. The two score boosts below
  -- are review-priority signals only and cannot make a timing-only session malicious.
  v_conviction_score := least(100, v_score);

  if v_session_attempts between 3 and 5
     and v_session_near >= 3
     and v_session_very_near >= 2 then
    v_score := v_score + 25;
    v_reasons := array_append(v_reasons, 'two_hour_extreme_precision_burst');
  end if;

  if v_session_attempts between 3 and 5
     and v_session_near = v_session_attempts then
    v_score := v_score + 15;
    v_reasons := array_append(v_reasons, 'two_hour_all_near_perfect');
  end if;

  v_score := least(100, v_score);

  v_legacy_malicious := v_near >= 4
    and v_fingerprint >= 3
    and (v_nicks >= 3 or v_automation_shape >= 4);

  v_session_automation_malicious := v_session_near >= 3
    and v_session_automation >= 3
    and v_session_fingerprint >= 2;

  v_malicious := v_conviction_score >= 65
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

create or replace function public.game_admin_attempt_manual_state(p_attempt_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_action public.game_admin_attempt_actions%rowtype;
begin
  select action.* into v_action
  from public.game_admin_attempt_actions action
  where action.attempt_id = p_attempt_id
  order by action.created_at desc, action.id desc
  limit 1;

  if not found then
    return jsonb_build_object('invalidated', false, 'action', null);
  end if;

  return jsonb_build_object(
    'invalidated', v_action.action = 'invalidate',
    'action', v_action.action,
    'reason', v_action.reason,
    'createdAt', v_action.created_at,
    'actionId', v_action.id
  );
end;
$$;

create or replace function public.enforce_game_admin_attempt_invalidation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_action text;
begin
  if new.verified is not true then return new; end if;

  select action.action into v_action
  from public.game_admin_attempt_actions action
  where action.attempt_id = new.id
  order by action.created_at desc, action.id desc
  limit 1;

  if v_action = 'invalidate' then
    new.verified := false;
  end if;
  return new;
end;
$$;

drop trigger if exists game_attempts_preserve_admin_invalidation on public.game_attempts;
create trigger game_attempts_preserve_admin_invalidation
before update of verified on public.game_attempts
for each row execute function public.enforce_game_admin_attempt_invalidation();

create or replace function public.zadmin_set_attempt_review(
  p_attempt_id uuid,
  p_invalidated boolean,
  p_reason text,
  p_actor_session_id uuid,
  p_at timestamptz default clock_timestamp()
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := coalesce(p_at, clock_timestamp());
  v_reason text := trim(coalesce(p_reason, ''));
  v_attempt public.game_attempts%rowtype;
  v_previous_action text;
  v_action text := case when p_invalidated then 'invalidate' else 'restore' end;
  v_reassess jsonb;
  v_effective_verified boolean;
begin
  if p_invalidated is null then return jsonb_build_object('error', 'invalid_action'); end if;
  if char_length(v_reason) not between 3 and 500 then return jsonb_build_object('error', 'invalid_reason'); end if;
  if not exists (
    select 1 from public.game_admin_sessions session
    where session.id = p_actor_session_id
      and session.revoked_at is null
      and session.expires_at > v_now
  ) then return jsonb_build_object('error', 'invalid_session'); end if;

  perform pg_advisory_xact_lock(hashtextextended('zadmin-attempt:' || p_attempt_id::text, 0));

  select attempt.* into v_attempt
  from public.game_attempts attempt
  where attempt.id = p_attempt_id
  for update;
  if not found then return jsonb_build_object('error', 'attempt_not_found'); end if;

  select action.action into v_previous_action
  from public.game_admin_attempt_actions action
  where action.attempt_id = p_attempt_id
  order by action.created_at desc, action.id desc
  limit 1;

  if p_invalidated and v_previous_action = 'invalidate' then
    return jsonb_build_object('error', 'attempt_already_invalidated');
  end if;
  if not p_invalidated and coalesce(v_previous_action, '') <> 'invalidate' then
    return jsonb_build_object('error', 'attempt_not_invalidated');
  end if;

  insert into public.game_admin_attempt_actions(
    attempt_id, action, reason, created_by_session_id, created_at
  ) values (
    p_attempt_id, v_action, v_reason, p_actor_session_id, v_now
  );

  if p_invalidated then
    perform set_config('minuto106.integrity_reconcile', 'on', true);
    update public.game_attempts
    set verified = false
    where id = p_attempt_id;
    perform set_config('minuto106.integrity_reconcile', 'off', true);
    perform public.reconcile_game_integrity_attempts(array[p_attempt_id]);
  else
    v_reassess := public.reassess_game_integrity_cluster(p_attempt_id);
  end if;

  select attempt.verified into v_effective_verified
  from public.game_attempts attempt
  where attempt.id = p_attempt_id;

  insert into public.game_admin_audit_events(
    session_id, action, target_scope, target_key, metadata, created_at
  ) values (
    p_actor_session_id,
    case when p_invalidated then 'invalidate_attempt' else 'restore_attempt' end,
    'attempt',
    p_attempt_id::text,
    jsonb_build_object(
      'reason', v_reason,
      'effectiveVerified', coalesce(v_effective_verified, false),
      'reassessment', coalesce(v_reassess, '{}'::jsonb)
    ),
    v_now
  );

  return jsonb_build_object(
    'attemptId', p_attempt_id,
    'invalidated', p_invalidated,
    'effectiveVerified', coalesce(v_effective_verified, false),
    'reason', v_reason,
    'updatedAt', v_now,
    'reassessment', coalesce(v_reassess, '{}'::jsonb)
  );
end;
$$;

create or replace view public.game_admin_attempt_facts
with (security_invoker = true)
as
select
  attempt.id,
  attempt.nick,
  attempt.nick_key,
  account_player.account_id,
  attempt.device_hash,
  attempt.ip_hash,
  attempt.difference_ms,
  attempt.verified,
  attempt.verification_reasons,
  attempt.created_at,
  case
    when manual.action = 'invalidate' then 'excluded'
    else coalesce(integrity.status, case when attempt.verified then 'eligible' else 'excluded' end)
  end as integrity_status,
  coalesce(integrity.risk_score, 0) as risk_score,
  coalesce(integrity.risk_reasons, '{}'::text[]) as risk_reasons,
  coalesce(integrity.evidence, '{}'::jsonb) as integrity_evidence,
  coalesce(integrity.policy_version, 0) as integrity_policy_version,
  integrity.evaluated_at as integrity_evaluated_at,
  coalesce(manual.action = 'invalidate', false) as manual_invalidated,
  manual.action as manual_action,
  manual.reason as manual_action_reason,
  manual.created_at as manual_action_at
from public.game_attempts attempt
left join public.game_account_players account_player
  on account_player.nick_key = attempt.nick_key
left join public.game_attempt_integrity integrity
  on integrity.attempt_id = attempt.id
left join lateral (
  select action.action, action.reason, action.created_at
  from public.game_admin_attempt_actions action
  where action.attempt_id = attempt.id
  order by action.created_at desc, action.id desc
  limit 1
) manual on true;

revoke all on table public.game_admin_attempt_facts from public, anon, authenticated;
grant select on table public.game_admin_attempt_facts to service_role;

revoke all on function public.game_admin_attempt_manual_state(uuid) from public, anon, authenticated;
revoke all on function public.enforce_game_admin_attempt_invalidation() from public, anon, authenticated;
revoke all on function public.zadmin_set_attempt_review(uuid, boolean, text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.zadmin_create_session(text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.zadmin_validate_session(text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.game_attempt_integrity_decision(jsonb) from public, anon, authenticated;

grant execute on function public.game_admin_attempt_manual_state(uuid) to service_role;
grant execute on function public.zadmin_set_attempt_review(uuid, boolean, text, uuid, timestamptz) to service_role;
grant execute on function public.zadmin_create_session(text, text, text, timestamptz) to service_role;
grant execute on function public.zadmin_validate_session(text, text, text, timestamptz) to service_role;
grant execute on function public.game_attempt_integrity_decision(jsonb) to service_role;

comment on table public.game_admin_attempt_actions is
  'Append-only operator review ledger for individual ranked attempts. Raw attempt evidence is never deleted; restore delegates effective eligibility back to canonical integrity reassessment.';
comment on function public.zadmin_set_attempt_review(uuid, boolean, text, uuid, timestamptz) is
  'Audited individual attempt invalidation/restoration. Invalidations reconcile derived rewards; restores rerun canonical integrity policy.';
comment on function public.zadmin_validate_session(text, text, text, timestamptz) is
  'Validates an IP/device-bound memory-only admin token and extends its server-side 12-hour idle expiry on authenticated use.';
comment on function public.game_attempt_integrity_decision(jsonb) is
  'Policy-v3 enforcement with stronger review scoring for concentrated early extreme precision. Review-only precision boosts cannot create a malicious verdict by themselves.';
comment on view public.game_admin_attempt_facts is
  'Service-role-only investigation projection with canonical integrity evidence plus the latest append-only manual attempt-review state.';

-- Re-score existing history once so current investigations immediately receive the
-- stronger review-priority score. Existing policy-v3 malicious gates remain unchanged.
select public.rebuild_game_attempt_integrity(true);
