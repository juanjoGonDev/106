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

  -- Share the exact lock namespace used by complete_game_account_referral().
  -- Live completion and retrospective integrity correction therefore serialize
  -- on the same canonical account instead of racing two derived projections.
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

create or replace function public.reassess_game_integrity_cluster(p_anchor_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_anchor public.game_attempts%rowtype;
  v_anchor_integrity public.game_attempt_integrity%rowtype;
  v_evidence jsonb;
  v_decision jsonb;
  v_decision_status text := 'eligible';
  v_decision_score integer := 0;
  v_decision_reasons text[] := '{}'::text[];
  v_target record;
  v_next_status text;
  v_next_score integer;
  v_next_reasons text[];
  v_should_verify boolean;
  v_changed_attempts uuid[] := '{}'::uuid[];
  v_state_changes integer := 0;
  v_projection_changes integer := 0;
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
  )
  select
    attempt.id,
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
  if not found then
    return jsonb_build_object('error', 'attempt_not_found');
  end if;

  -- Every production finish for the same persisted device must observe the
  -- previous transaction's completed cluster decision before calculating its
  -- own evidence. The transaction-scoped lock also protects explicit service
  -- role reassessment calls, not only the normal finish path.
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

    if v_projection_changes > 0
       and coalesce(current_setting('minuto106.integrity_bulk', true), '') <> 'on' then
      perform public.reconcile_game_integrity_attempts(v_changed_attempts);
    end if;

    return jsonb_build_object(
      'status', 'excluded',
      'riskScore', v_anchor_integrity.risk_score,
      'hardValid', false,
      'projectionChanges', v_projection_changes
    );
  end if;

  if v_anchor.difference_ms <= 5 then
    v_evidence := public.game_attempt_integrity_evidence(v_anchor.id);
    v_decision := public.game_attempt_integrity_decision(v_evidence);
    v_decision_status := coalesce(v_decision->>'status', 'eligible');
    v_decision_score := greatest(0, least(100, coalesce((v_decision->>'riskScore')::integer, 0)));
    select coalesce(array_agg(reason), '{}'::text[])
    into v_decision_reasons
    from jsonb_array_elements_text(coalesce(v_decision->'reasons', '[]'::jsonb)) reason;
  else
    v_evidence := jsonb_build_object(
      'anchorAttemptId', v_anchor.id,
      'reason', 'not_near_perfect',
      'windowEnd', v_anchor.created_at
    );
    v_decision := jsonb_build_object(
      'status', 'eligible',
      'riskScore', 0,
      'reasons', '[]'::jsonb,
      'policyVersion', 2
    );
  end if;

  perform set_config('minuto106.integrity_reconcile', 'on', true);

  for v_target in
    select attempt.id,
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
          v_anchor.difference_ms <= 5
          and attempt.device_hash = v_anchor.device_hash
          and attempt.difference_ms <= 5
          and attempt.created_at between v_anchor.created_at - interval '24 hours' and v_anchor.created_at
        )
      )
    order by attempt.created_at, attempt.id
  loop
    v_next_status := case
      when v_target.status = 'excluded' or v_decision_status = 'excluded' then 'excluded'
      when v_target.status = 'watch' or v_decision_status = 'watch' then 'watch'
      else 'eligible'
    end;
    v_next_score := greatest(v_target.risk_score, v_decision_score);

    select coalesce(array_agg(distinct reason order by reason), '{}'::text[])
    into v_next_reasons
    from unnest(coalesce(v_target.risk_reasons, '{}'::text[]) || v_decision_reasons) reason;

    v_should_verify := v_target.hard_valid and v_next_status <> 'excluded';

    if v_target.status is distinct from v_next_status
       or v_target.risk_score is distinct from v_next_score
       or v_target.risk_reasons is distinct from v_next_reasons
       or v_target.policy_version is distinct from 2
       or v_target.verified is distinct from v_should_verify then
      insert into public.game_attempt_integrity_events(
        attempt_id,
        previous_status,
        next_status,
        previous_score,
        next_score,
        reasons,
        evidence,
        policy_version
      ) values (
        v_target.id,
        v_target.status,
        v_next_status,
        v_target.risk_score,
        v_next_score,
        v_next_reasons,
        v_evidence || jsonb_build_object('decision', v_decision),
        2
      );

      update public.game_attempt_integrity
      set status = v_next_status,
          risk_score = v_next_score,
          risk_reasons = v_next_reasons,
          evidence = v_evidence || jsonb_build_object('decision', v_decision),
          policy_version = 2,
          evaluated_at = clock_timestamp()
      where attempt_id = v_target.id;
      v_state_changes := v_state_changes + 1;

      if v_target.verified is distinct from v_should_verify then
        update public.game_attempts
        set verified = v_should_verify
        where id = v_target.id;
        v_changed_attempts := array_append(v_changed_attempts, v_target.id);
        v_projection_changes := v_projection_changes + 1;
      end if;
    end if;
  end loop;

  perform set_config('minuto106.integrity_reconcile', 'off', true);

  if v_projection_changes > 0
     and coalesce(current_setting('minuto106.integrity_bulk', true), '') <> 'on' then
    perform public.reconcile_game_integrity_attempts(v_changed_attempts);
  end if;

  select integrity.* into v_anchor_integrity
  from public.game_attempt_integrity integrity
  where integrity.attempt_id = v_anchor.id;

  return jsonb_build_object(
    'status', v_anchor_integrity.status,
    'riskScore', v_anchor_integrity.risk_score,
    'hardValid', v_anchor_integrity.hard_valid,
    'reasons', to_jsonb(v_anchor_integrity.risk_reasons),
    'stateChanges', v_state_changes,
    'projectionChanges', v_projection_changes,
    'policyVersion', v_anchor_integrity.policy_version
  );
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
  perform pg_advisory_xact_lock(hashtextextended('minuto106:integrity-policy-v2', 106));

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
    case when public.game_attempt_hard_valid(attempt.verified, attempt.verification_reasons) then 'eligible' else 'excluded' end,
    0,
    case when public.game_attempt_hard_valid(attempt.verified, attempt.verification_reasons)
      then '{}'::text[] else coalesce(attempt.verification_reasons, '{}'::text[]) end,
    jsonb_build_object('source', 'rebuild_seed'),
    1,
    clock_timestamp()
  from public.game_attempts attempt
  on conflict (attempt_id) do nothing;

  select count(*)::integer into v_pending
  from public.game_attempt_integrity integrity
  where integrity.policy_version < 2;

  if not p_force and v_pending = 0 then
    return jsonb_build_object(
      'policyVersion', 2,
      'reassessed', 0,
      'verifiedChanges', 0,
      'alreadyCurrent', true
    );
  end if;

  perform set_config('minuto106.integrity_bulk', 'on', true);
  perform set_config('minuto106.integrity_reconcile', 'on', true);

  insert into public.game_attempt_integrity_events(
    attempt_id,
    previous_status,
    next_status,
    previous_score,
    next_score,
    reasons,
    evidence,
    policy_version
  )
  select
    integrity.attempt_id,
    integrity.status,
    case when integrity.hard_valid then 'eligible' else 'excluded' end,
    integrity.risk_score,
    0,
    case when integrity.hard_valid then '{}'::text[] else integrity.risk_reasons end,
    jsonb_build_object('source', 'policy_v2_rebuild_reset'),
    2
  from public.game_attempt_integrity integrity
  where p_force or integrity.policy_version < 2;

  update public.game_attempt_integrity integrity
  set status = case when integrity.hard_valid then 'eligible' else 'excluded' end,
      risk_score = 0,
      risk_reasons = case when integrity.hard_valid then '{}'::text[] else integrity.risk_reasons end,
      evidence = jsonb_build_object('source', 'policy_v2_rebuild_reset'),
      policy_version = 2,
      evaluated_at = clock_timestamp()
  where p_force or integrity.policy_version < 2;

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
      and attempt.difference_ms <= 5
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
    select player.nick_key
    from public.game_players player
    order by player.nick_key
  loop
    perform public.rebuild_game_player_achievements(v_nick_key);
  end loop;

  return jsonb_build_object(
    'policyVersion', 2,
    'reassessed', v_reassessed,
    'verifiedChanges', v_verified_changes,
    'alreadyCurrent', false
  );
end;
$$;

revoke all on function public.reconcile_game_account_referral(uuid) from public, anon, authenticated;
revoke all on function public.reassess_game_integrity_cluster(uuid) from public, anon, authenticated;
revoke all on function public.rebuild_game_attempt_integrity(boolean) from public, anon, authenticated;

grant execute on function public.reconcile_game_account_referral(uuid) to service_role;
grant execute on function public.reassess_game_integrity_cluster(uuid) to service_role;
grant execute on function public.rebuild_game_attempt_integrity(boolean) to service_role;

comment on function public.reconcile_game_account_referral(uuid) is
  'Recomputes referral completion from current verified history under the same canonical-account advisory lock used by live completion.';
comment on function public.reassess_game_integrity_cluster(uuid) is
  'Serializes same-device policy-v2 reassessment, preserves raw evidence, and reconciles derived projections after eligibility changes.';
comment on function public.rebuild_game_attempt_integrity(boolean) is
  'Deterministically reapplies policy v2 and reports all verified projection writes, including reassessment-driven exclusions.';

-- The previous migration already performed the initial policy-v2 rebuild. Re-run
-- once with the serialized implementation so installations applying this forward
-- migration finish in a state produced entirely by the hardened path.
select public.rebuild_game_attempt_integrity(true);
