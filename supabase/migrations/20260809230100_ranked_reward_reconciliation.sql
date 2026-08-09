update public.game_attempt_integrity
set policy_version = 1
where evidence->>'source' = 'legacy_backfill'
  and policy_version = 2;

create or replace function public.game_daily_award_candidates(p_award_date date)
returns table (
  trophy_type text,
  nick_key text,
  nick text,
  team text,
  metric_value integer,
  attempt_count integer,
  best_difference_ms integer,
  average_difference_ms integer,
  best_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
with daily as (
  select attempt.id,
    attempt.nick_key,
    attempt.nick,
    attempt.team,
    attempt.difference_ms,
    attempt.created_at
  from public.game_attempts attempt
  where attempt.verified = true
    and attempt.league_id is null
    and public.game_server_day(attempt.created_at) = p_award_date
), best_events as (
  select distinct on (attempt.nick_key)
    attempt.nick_key,
    attempt.created_at as best_at
  from daily attempt
  order by attempt.nick_key, attempt.difference_ms, attempt.created_at, attempt.id
), latest_teams as (
  select distinct on (attempt.nick_key)
    attempt.nick_key,
    attempt.team
  from daily attempt
  order by attempt.nick_key, attempt.created_at desc, attempt.id desc
), summaries as (
  select attempt.nick_key,
    max(attempt.nick) as nick,
    max(team.team) as team,
    count(*)::integer as attempts,
    min(attempt.difference_ms)::integer as best_difference_ms,
    round(avg(attempt.difference_ms))::integer as average_difference_ms,
    best.best_at
  from daily attempt
  join best_events best using (nick_key)
  join latest_teams team using (nick_key)
  group by attempt.nick_key, best.best_at
)
(select
  'golden_boot'::text,
  summary.nick_key,
  summary.nick,
  summary.team,
  summary.best_difference_ms,
  summary.attempts,
  summary.best_difference_ms,
  summary.average_difference_ms,
  summary.best_at
from summaries summary
order by summary.best_difference_ms, summary.best_at, summary.nick_key
limit 1)
union all
(select
  'golden_glove'::text,
  summary.nick_key,
  summary.nick,
  summary.team,
  summary.average_difference_ms,
  summary.attempts,
  summary.best_difference_ms,
  summary.average_difference_ms,
  summary.best_at
from summaries summary
where summary.attempts >= 3
order by summary.average_difference_ms, summary.best_difference_ms, summary.best_at, summary.nick_key
limit 1)
union all
(select
  'golden_ball'::text,
  summary.nick_key,
  summary.nick,
  summary.team,
  summary.attempts,
  summary.attempts,
  summary.best_difference_ms,
  summary.average_difference_ms,
  summary.best_at
from summaries summary
order by summary.attempts desc, summary.best_difference_ms, summary.average_difference_ms, summary.best_at, summary.nick_key
limit 1);
$$;

create or replace function public.get_game_daily_awards_for_date(p_award_date date)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
with candidates as (
  select * from public.game_daily_award_candidates(p_award_date)
), awards as (
  select
    (select jsonb_build_object('nick', candidate.nick, 'team', candidate.team, 'value', candidate.metric_value)
      from candidates candidate where candidate.trophy_type = 'golden_boot') as golden_boot,
    (select jsonb_build_object('nick', candidate.nick, 'team', candidate.team, 'value', candidate.metric_value)
      from candidates candidate where candidate.trophy_type = 'golden_glove') as golden_glove,
    (select jsonb_build_object('nick', candidate.nick, 'team', candidate.team, 'value', candidate.metric_value)
      from candidates candidate where candidate.trophy_type = 'golden_ball') as golden_ball
)
select jsonb_build_object(
  'date', p_award_date,
  'resetAt', public.game_server_reset_at(p_award_date),
  'provisional', p_award_date >= public.game_server_day(clock_timestamp()),
  'goldenBoot', awards.golden_boot,
  'goldenGlove', awards.golden_glove,
  'goldenBall', awards.golden_ball
)
from awards;
$$;

create or replace function public.get_game_daily_awards()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.get_game_daily_awards_for_date(public.game_server_day(clock_timestamp()));
$$;

create or replace function public.reconcile_game_trophies_for_date(p_award_date date)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_today date := public.game_server_day(clock_timestamp());
  v_old_nicks text[] := '{}'::text[];
  v_trophy_count integer := 0;
  v_nick_key text;
begin
  if p_award_date is null or p_award_date >= v_today then
    return 0;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('minuto106:trophy-date:' || p_award_date::text, 106));

  select coalesce(array_agg(distinct trophy.nick_key), '{}'::text[])
  into v_old_nicks
  from public.game_daily_trophies trophy
  where trophy.award_date = p_award_date;

  insert into public.game_daily_trophies as trophy(
    award_date,
    trophy_type,
    nick_key,
    metric_value,
    attempt_count,
    best_difference_ms,
    average_difference_ms
  )
  select
    p_award_date,
    candidate.trophy_type,
    candidate.nick_key,
    candidate.metric_value,
    candidate.attempt_count,
    candidate.best_difference_ms,
    candidate.average_difference_ms
  from public.game_daily_award_candidates(p_award_date) candidate
  on conflict (award_date, trophy_type) do update
  set nick_key = excluded.nick_key,
      metric_value = excluded.metric_value,
      attempt_count = excluded.attempt_count,
      best_difference_ms = excluded.best_difference_ms,
      average_difference_ms = excluded.average_difference_ms,
      awarded_at = case
        when trophy.nick_key is distinct from excluded.nick_key
          or trophy.metric_value is distinct from excluded.metric_value
          or trophy.attempt_count is distinct from excluded.attempt_count
          or trophy.best_difference_ms is distinct from excluded.best_difference_ms
          or trophy.average_difference_ms is distinct from excluded.average_difference_ms
          then clock_timestamp()
        else trophy.awarded_at
      end;

  delete from public.game_daily_trophies trophy
  where trophy.award_date = p_award_date
    and not exists (
      select 1
      from public.game_daily_award_candidates(p_award_date) candidate
      where candidate.trophy_type = trophy.trophy_type
    );

  select count(*)::integer
  into v_trophy_count
  from public.game_daily_trophies trophy
  where trophy.award_date = p_award_date;

  insert into public.game_trophy_award_runs(award_date, trophy_count, processed_at, policy_version)
  values (p_award_date, v_trophy_count, clock_timestamp(), 2)
  on conflict (award_date) do update
  set trophy_count = excluded.trophy_count,
      processed_at = excluded.processed_at,
      policy_version = excluded.policy_version;

  if coalesce(current_setting('minuto106.integrity_bulk', true), '') <> 'on' then
    for v_nick_key in
      select distinct affected.nick_key
      from (
        select unnest(v_old_nicks) as nick_key
        union all
        select trophy.nick_key
        from public.game_daily_trophies trophy
        where date_trunc('month', trophy.award_date::timestamp)::date
          = date_trunc('month', p_award_date::timestamp)::date
      ) affected
      where affected.nick_key is not null
    loop
      perform public.rebuild_game_player_achievements(v_nick_key);
    end loop;
  end if;

  return v_trophy_count;
end;
$$;

create or replace function public.award_game_trophies_for_date(p_award_date date)
returns integer
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  select public.reconcile_game_trophies_for_date(p_award_date);
$$;

create or replace function public.sync_game_trophy_history(p_through_date date default null)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_today date := public.game_server_day(clock_timestamp());
  v_through_date date := least(coalesce(p_through_date, v_today - 1), v_today - 1);
  v_award_date date;
  v_processed integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended('minuto106:trophy-sync', 106));

  for v_award_date in
    select distinct public.game_server_day(attempt.created_at) as award_date
    from public.game_attempts attempt
    left join public.game_trophy_award_runs run
      on run.award_date = public.game_server_day(attempt.created_at)
    where attempt.league_id is null
      and public.game_server_day(attempt.created_at) <= v_through_date
      and (run.award_date is null or run.policy_version < 2)
    order by 1
  loop
    perform public.reconcile_game_trophies_for_date(v_award_date);
    v_processed := v_processed + 1;
  end loop;

  return v_processed;
end;
$$;

create or replace function public.get_game_player_honours_progress(p_nick_key text)
returns jsonb
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
with today_window as (
  select public.game_server_day(clock_timestamp()) as today
), today_attempts as (
  select attempt.*
  from public.game_attempts attempt
  cross join today_window day_window
  where attempt.verified = true
    and attempt.league_id is null
    and public.game_server_day(attempt.created_at) = day_window.today
), player_today as (
  select attempt.nick_key,
    count(*)::integer as attempts,
    min(attempt.difference_ms)::integer as best_difference_ms,
    round(avg(attempt.difference_ms))::integer as average_difference_ms
  from today_attempts attempt
  where attempt.nick_key = p_nick_key
  group by attempt.nick_key
), today_candidates as (
  select candidate.*
  from today_window day_window
  cross join lateral public.game_daily_award_candidates(day_window.today) candidate
), trophy_days as (
  select distinct trophy.award_date
  from public.game_daily_trophies trophy
  where trophy.nick_key = p_nick_key
), numbered_trophy_days as (
  select award_date,
    award_date - row_number() over(order by award_date)::integer as island_key
  from trophy_days
), trophy_streaks as (
  select count(*)::integer as length
  from numbered_trophy_days
  group by island_key
), completed_leagues as (
  select count(distinct league.id)::integer as total
  from public.game_leagues league
  join public.game_league_trophies trophy on trophy.league_id = league.id
  where exists (
    select 1
    from public.game_attempts attempt
    where attempt.league_id = league.id
      and attempt.nick_key = p_nick_key
      and attempt.verified = true
  )
), duel_totals as (
  select
    count(*) filter (where duel.challenger_nick_key = p_nick_key)::integer as created,
    count(*) filter (
      where duel.status = 'completed'
        and duel.completed_at is not null
        and (
          (
            duel.challenger_nick_key = p_nick_key
            and coalesce(duel.opponent_best_difference_ms, 2147483647) >= duel.challenger_best_difference_ms
          )
          or (
            duel.opponent_nick_key = p_nick_key
            and duel.opponent_best_difference_ms < duel.challenger_best_difference_ms
          )
        )
    )::integer as won
  from public.game_duels duel
)
select jsonb_build_object(
  'perfectAttempts', (
    select count(*)::integer
    from public.game_attempts attempt
    where attempt.nick_key = p_nick_key
      and attempt.verified = true
      and attempt.difference_ms = 0
  ),
  'verifiedAttempts', (
    select count(*)::integer
    from public.game_attempts attempt
    where attempt.nick_key = p_nick_key
      and attempt.verified = true
  ),
  'completedReferrals', (
    select count(*)::integer
    from public.game_referrals referral
    where referral.referrer_nick_key = p_nick_key
      and referral.completed_at is not null
  ),
  'duelsCreated', coalesce((select created from duel_totals), 0),
  'duelsWon', coalesce((select won from duel_totals), 0),
  'completedLeagues', coalesce((select total from completed_leagues), 0),
  'longestTrophyStreak', coalesce((select max(length) from trophy_streaks), 0),
  'trophyCategoryCount', (
    select count(distinct trophy.trophy_type)::integer
    from public.game_daily_trophies trophy
    where trophy.nick_key = p_nick_key
  ),
  'maxDailyTrophyCategories', coalesce((
    select max(day_total)::integer
    from (
      select count(distinct trophy.trophy_type)::integer as day_total
      from public.game_daily_trophies trophy
      where trophy.nick_key = p_nick_key
      group by trophy.award_date
    ) daily_totals
  ), 0),
  'today', jsonb_build_object(
    'date', (select today from today_window),
    'attempts', coalesce((select attempts from player_today), 0),
    'bestDifferenceMs', (select best_difference_ms from player_today),
    'averageDifferenceMs', (select average_difference_ms from player_today),
    'goldenBoot', jsonb_build_object(
      'leaderNick', (select nick from today_candidates where trophy_type = 'golden_boot'),
      'targetDifferenceMs', (select metric_value from today_candidates where trophy_type = 'golden_boot'),
      'leading', exists(select 1 from today_candidates where trophy_type = 'golden_boot' and nick_key = p_nick_key)
    ),
    'goldenGlove', jsonb_build_object(
      'requiredAttempts', 3,
      'eligible', coalesce((select attempts >= 3 from player_today), false),
      'leaderNick', (select nick from today_candidates where trophy_type = 'golden_glove'),
      'targetAverageDifferenceMs', (select metric_value from today_candidates where trophy_type = 'golden_glove'),
      'leading', exists(select 1 from today_candidates where trophy_type = 'golden_glove' and nick_key = p_nick_key)
    ),
    'goldenBall', jsonb_build_object(
      'leaderNick', (select nick from today_candidates where trophy_type = 'golden_ball'),
      'targetAttempts', coalesce((select metric_value from today_candidates where trophy_type = 'golden_ball'), 0),
      'leading', exists(select 1 from today_candidates where trophy_type = 'golden_ball' and nick_key = p_nick_key)
    )
  )
);
$$;

create or replace function public.reconcile_game_league_trophy(p_league_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_league public.game_leagues%rowtype;
  v_state jsonb;
  v_existing public.game_league_trophies%rowtype;
  v_winner record;
  v_had_existing boolean := false;
  v_has_winner boolean := false;
  v_changed boolean := false;
  v_nick_key text;
begin
  select league.* into v_league
  from public.game_leagues league
  where league.id = p_league_id
  for update;

  if not found or v_league.activated_at is null or v_league.ends_at > clock_timestamp() then
    return 0;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('integrity-league:' || v_league.id::text, 106));
  v_state := public.get_game_league_activation_state(v_league.id);

  select trophy.* into v_existing
  from public.game_league_trophies trophy
  where trophy.league_id = v_league.id;
  v_had_existing := found;

  if coalesce((v_state->>'eligible')::boolean, false) then
    select attempt.id, attempt.nick_key, attempt.difference_ms
    into v_winner
    from public.game_attempts attempt
    where attempt.league_id = v_league.id
      and attempt.verified = true
    order by attempt.difference_ms, attempt.created_at, attempt.nick_key, attempt.id
    limit 1;
    v_has_winner := found;
  end if;

  if not v_has_winner then
    if v_had_existing then
      delete from public.game_league_trophies trophy
      where trophy.league_id = v_league.id;
      v_changed := true;
    end if;
  elsif not v_had_existing
     or v_existing.nick_key is distinct from v_winner.nick_key
     or v_existing.winning_attempt_id is distinct from v_winner.id
     or v_existing.best_difference_ms is distinct from v_winner.difference_ms
     or v_existing.participant_count is distinct from (v_state->>'participantCount')::integer
     or v_existing.owner_count is distinct from (v_state->>'eligibleOwners')::integer
     or v_existing.device_count is distinct from (v_state->>'eligibleDevices')::integer then
    insert into public.game_league_trophies as trophy(
      league_id,
      nick_key,
      winning_attempt_id,
      best_difference_ms,
      participant_count,
      owner_count,
      device_count,
      awarded_at
    ) values (
      v_league.id,
      v_winner.nick_key,
      v_winner.id,
      v_winner.difference_ms,
      (v_state->>'participantCount')::integer,
      (v_state->>'eligibleOwners')::integer,
      (v_state->>'eligibleDevices')::integer,
      clock_timestamp()
    )
    on conflict (league_id) do update
    set nick_key = excluded.nick_key,
        winning_attempt_id = excluded.winning_attempt_id,
        best_difference_ms = excluded.best_difference_ms,
        participant_count = excluded.participant_count,
        owner_count = excluded.owner_count,
        device_count = excluded.device_count,
        awarded_at = excluded.awarded_at;
    v_changed := true;
  end if;

  if v_changed
     and coalesce(current_setting('minuto106.integrity_bulk', true), '') <> 'on' then
    for v_nick_key in
      select member.nick_key
      from public.game_league_members member
      where member.league_id = v_league.id
    loop
      perform public.rebuild_game_player_achievements(v_nick_key);
    end loop;
  end if;

  return case when v_changed then 1 else 0 end;
end;
$$;

create or replace function public.sync_game_league_trophies()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_league_id uuid;
  v_changed integer := 0;
  v_total_changed integer := 0;
begin
  for v_league_id in
    select league.id
    from public.game_leagues league
    where league.activated_at is not null
      and league.ends_at <= clock_timestamp()
    order by league.ends_at, league.id
  loop
    v_changed := public.reconcile_game_league_trophy(v_league_id);
    v_total_changed := v_total_changed + coalesce(v_changed, 0);
  end loop;

  return v_total_changed;
end;
$$;

create or replace function public.reconcile_game_integrity_attempts(p_attempt_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_date date;
  v_league_id uuid;
  v_nick_key text;
  v_account_id uuid;
  v_reconciled integer := 0;
begin
  if coalesce(cardinality(p_attempt_ids), 0) = 0 then
    return 0;
  end if;

  for v_account_id in
    select distinct public.daily_game_account_id(account_player.account_id)
    from public.game_attempts attempt
    join public.game_account_players account_player on account_player.nick_key = attempt.nick_key
    where attempt.id = any(p_attempt_ids)
      and account_player.account_id is not null
  loop
    if public.reconcile_game_account_referral(v_account_id) then
      v_reconciled := v_reconciled + 1;
    end if;
  end loop;

  for v_date in
    select distinct public.game_server_day(attempt.created_at)
    from public.game_attempts attempt
    where attempt.id = any(p_attempt_ids)
      and attempt.league_id is null
      and public.game_server_day(attempt.created_at) < public.game_server_day(clock_timestamp())
  loop
    perform public.reconcile_game_trophies_for_date(v_date);
    v_reconciled := v_reconciled + 1;
  end loop;

  for v_league_id in
    select distinct attempt.league_id
    from public.game_attempts attempt
    where attempt.id = any(p_attempt_ids)
      and attempt.league_id is not null
  loop
    v_reconciled := v_reconciled + public.reconcile_game_league_trophy(v_league_id);
  end loop;

  if coalesce(current_setting('minuto106.integrity_bulk', true), '') <> 'on' then
    for v_nick_key in
      select distinct attempt.nick_key
      from public.game_attempts attempt
      where attempt.id = any(p_attempt_ids)
    loop
      perform public.rebuild_game_player_achievements(v_nick_key);
    end loop;
  end if;

  return v_reconciled;
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
    perform public.reassess_game_integrity_cluster(v_anchor_id);
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
  if p_client_elapsed_ms is null or p_client_elapsed_ms not between 2000 and 30000 then
    update public.game_challenges set consumed_at = v_now where id = p_challenge_id;
    return jsonb_build_object('error', 'invalid_timing');
  end if;

  v_server_elapsed_ms := round(extract(epoch from (v_now - v_challenge.started_at)) * 1000)::integer;
  v_transport_delta_ms := v_server_elapsed_ms - p_client_elapsed_ms;

  if v_is_timeout then
    if v_server_elapsed_ms not between 29250 and 33000 then
      update public.game_challenges set consumed_at = v_now where id = p_challenge_id;
      return jsonb_build_object(
        'error', 'timing_mismatch',
        'serverElapsedMs', v_server_elapsed_ms,
        'transportDeltaMs', v_transport_delta_ms
      );
    end if;
  elsif v_transport_delta_ms not between -750 and 2500 then
    update public.game_challenges set consumed_at = v_now where id = p_challenge_id;
    return jsonb_build_object(
      'error', 'timing_mismatch',
      'serverElapsedMs', v_server_elapsed_ms,
      'transportDeltaMs', v_transport_delta_ms
    );
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
    perform public.reassess_game_integrity_cluster(v_attempt_id);
    select attempt.verified into v_effective_verified
    from public.game_attempts attempt
    where attempt.id = v_attempt_id;
    v_result := jsonb_set(v_result, '{attempt,verified}', to_jsonb(coalesce(v_effective_verified, false)), true);
  end if;

  v_result := jsonb_set(v_result, '{attempt,serverElapsedMs}', to_jsonb(v_server_elapsed_ms), true);
  v_result := jsonb_set(v_result, '{attempt,transportDeltaMs}', to_jsonb(v_transport_delta_ms), true);
  return v_result;
end;
$$;

revoke all on function public.game_daily_award_candidates(date) from public, anon, authenticated;
revoke all on function public.get_game_daily_awards_for_date(date) from public, anon, authenticated;
revoke all on function public.get_game_daily_awards() from public, anon, authenticated;
revoke all on function public.reconcile_game_trophies_for_date(date) from public, anon, authenticated;
revoke all on function public.award_game_trophies_for_date(date) from public, anon, authenticated;
revoke all on function public.sync_game_trophy_history(date) from public, anon, authenticated;
revoke all on function public.get_game_player_honours_progress(text) from public, anon, authenticated;
revoke all on function public.reconcile_game_league_trophy(uuid) from public, anon, authenticated;
revoke all on function public.sync_game_league_trophies() from public, anon, authenticated;
revoke all on function public.reconcile_game_integrity_attempts(uuid[]) from public, anon, authenticated;
revoke all on function public.reassess_game_integrity_cluster(uuid) from public, anon, authenticated;
revoke all on function public.rebuild_game_attempt_integrity(boolean) from public, anon, authenticated;
revoke all on function public.finish_game_attempt_pointer_only(uuid, integer, text, text, jsonb) from public, anon, authenticated;

grant execute on function public.game_daily_award_candidates(date) to service_role;
grant execute on function public.get_game_daily_awards_for_date(date) to service_role;
grant execute on function public.get_game_daily_awards() to service_role;
grant execute on function public.reconcile_game_trophies_for_date(date) to service_role;
grant execute on function public.award_game_trophies_for_date(date) to service_role;
grant execute on function public.sync_game_trophy_history(date) to service_role;
grant execute on function public.get_game_player_honours_progress(text) to service_role;
grant execute on function public.reconcile_game_league_trophy(uuid) to service_role;
grant execute on function public.sync_game_league_trophies() to service_role;
grant execute on function public.reconcile_game_integrity_attempts(uuid[]) to service_role;
grant execute on function public.reassess_game_integrity_cluster(uuid) to service_role;
grant execute on function public.rebuild_game_attempt_integrity(boolean) to service_role;
grant execute on function public.finish_game_attempt_pointer_only(uuid, integer, text, text, jsonb) to service_role;

comment on function public.game_daily_award_candidates(date) is
  'Single source of truth for Golden Boot, Golden Glove and Golden Ball candidates for any Europe/Madrid game day.';
comment on function public.get_game_daily_awards_for_date(date) is
  'Projects the canonical date-based award candidates into the public award JSON contract.';
comment on function public.reconcile_game_trophies_for_date(date) is
  'Replaces derived closed-day trophy rows with the winners implied by current verified attempts and rebuilds affected achievements.';
comment on function public.reconcile_game_league_trophy(uuid) is
  'Replaces a finished league champion with the winner implied by current verified attempts, or removes the trophy when no eligible winner remains.';
comment on function public.rebuild_game_attempt_integrity(boolean) is
  'Deterministically migrates legacy heuristic exclusions to policy v2 and reconciles all derived referrals, trophies and achievements.';

select public.rebuild_game_attempt_integrity();
