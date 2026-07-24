alter table public.game_leagues
  add column if not exists activated_at timestamptz;

alter table public.game_league_members
  add column if not exists account_id uuid references public.game_accounts(id) on delete restrict,
  add column if not exists device_hash text;

update public.game_league_members member
set account_id = coalesce(member.account_id, (
      select account_player.account_id
      from public.game_account_players account_player
      where account_player.nick_key = member.nick_key
    )),
    device_hash = coalesce(member.device_hash, (
      select player.first_device_hash
      from public.game_players player
      where player.nick_key = member.nick_key
    ), (
      select league.owner_device_hash
      from public.game_leagues league
      where league.id = member.league_id
    ))
where member.account_id is null or member.device_hash is null;

update public.game_leagues
set activated_at = starts_at
where activated_at is null;

create index if not exists game_league_members_eligibility_idx
  on public.game_league_members(league_id, account_id, device_hash);

create index if not exists game_leagues_activation_idx
  on public.game_leagues(activated_at, ends_at);

create table if not exists public.game_league_trophies (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null unique references public.game_leagues(id) on delete restrict,
  nick_key text not null references public.game_players(nick_key) on delete cascade,
  winning_attempt_id uuid not null references public.game_attempts(id) on delete restrict,
  best_difference_ms integer not null check (best_difference_ms >= 0),
  participant_count integer not null check (participant_count >= 3),
  owner_count integer not null check (owner_count >= 3),
  device_count integer not null check (device_count >= 3),
  awarded_at timestamptz not null default clock_timestamp()
);

create index if not exists game_league_trophies_player_date_idx
  on public.game_league_trophies(nick_key, awarded_at desc);

alter table public.game_league_trophies enable row level security;
revoke all on table public.game_league_trophies from public, anon, authenticated;
grant all on table public.game_league_trophies to service_role;

create or replace function public.get_game_league_activation_state(p_league_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with members as (
    select member.nick_key, member.account_id, member.device_hash
    from public.game_league_members member
    where member.league_id = p_league_id
  ), counts as (
    select
      count(*)::integer as participant_count,
      count(distinct account_id) filter (where account_id is not null)::integer as owner_count,
      count(distinct device_hash) filter (where device_hash is not null)::integer as device_count
    from members
  ), eligible as (
    select exists (
      select 1
      from members first_member
      join members second_member on second_member.nick_key > first_member.nick_key
      join members third_member on third_member.nick_key > second_member.nick_key
      where first_member.account_id is not null
        and second_member.account_id is not null
        and third_member.account_id is not null
        and first_member.device_hash is not null
        and second_member.device_hash is not null
        and third_member.device_hash is not null
        and first_member.account_id <> second_member.account_id
        and first_member.account_id <> third_member.account_id
        and second_member.account_id <> third_member.account_id
        and first_member.device_hash <> second_member.device_hash
        and first_member.device_hash <> third_member.device_hash
        and second_member.device_hash <> third_member.device_hash
    ) as eligible
  )
  select jsonb_build_object(
    'requiredParticipants', 3,
    'participantCount', counts.participant_count,
    'eligibleOwners', counts.owner_count,
    'eligibleDevices', counts.device_count,
    'participantsNeeded', greatest(
      0,
      3 - counts.participant_count,
      3 - counts.owner_count,
      3 - counts.device_count
    ),
    'eligible', eligible.eligible
  )
  from counts cross join eligible;
$$;

create or replace function public.activate_game_league_if_eligible(p_league_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_league public.game_leagues%rowtype;
  v_state jsonb;
  v_now timestamptz := clock_timestamp();
begin
  select * into v_league
  from public.game_leagues
  where id = p_league_id
  for update;

  if not found then
    return jsonb_build_object('error', 'league_not_found');
  end if;

  v_state := public.get_game_league_activation_state(v_league.id);

  if v_league.activated_at is null and coalesce((v_state->>'eligible')::boolean, false) then
    update public.game_leagues
    set activated_at = v_now,
        starts_at = v_now,
        ends_at = v_now + interval '3 days'
    where id = v_league.id
    returning * into v_league;
  end if;

  return v_state || jsonb_build_object(
    'active', v_league.activated_at is not null and v_league.ends_at > v_now,
    'waiting', v_league.activated_at is null,
    'finished', v_league.activated_at is not null and v_league.ends_at <= v_now,
    'activatedAt', v_league.activated_at,
    'startsAt', case when v_league.activated_at is null then null else v_league.starts_at end,
    'endsAt', case when v_league.activated_at is null then null else v_league.ends_at end
  );
end;
$$;

create or replace function public.create_game_league(
  p_name text,
  p_owner_nick_key text,
  p_device_hash text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_code text;
  v_random_bytes bytea;
  v_account_id uuid;
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  if char_length(trim(p_name)) not between 3 and 40 then
    return jsonb_build_object('error', 'invalid_league_name');
  end if;

  select account_player.account_id into v_account_id
  from public.game_account_players account_player
  where account_player.nick_key = p_owner_nick_key;

  if v_account_id is null then
    return jsonb_build_object('error', 'player_access_denied');
  end if;

  if (
    select count(*)
    from public.game_leagues
    where owner_nick_key = p_owner_nick_key
      and created_at > clock_timestamp() - interval '7 days'
  ) >= 3 then
    return jsonb_build_object('error', 'league_limit');
  end if;

  loop
    v_random_bytes := extensions.gen_random_bytes(6);
    select string_agg(
      substr(v_alphabet, (get_byte(v_random_bytes, byte_index) % 32) + 1, 1),
      '' order by byte_index
    ) into v_code
    from generate_series(0, 5) as byte_index;
    exit when not exists (select 1 from public.game_leagues where code = v_code);
  end loop;

  insert into public.game_leagues(
    code,
    name,
    owner_nick_key,
    owner_device_hash,
    starts_at,
    ends_at,
    activated_at
  ) values (
    v_code,
    trim(p_name),
    p_owner_nick_key,
    p_device_hash,
    clock_timestamp(),
    clock_timestamp(),
    null
  ) returning id into v_id;

  insert into public.game_league_members(league_id, nick_key, account_id, device_hash)
  values (v_id, p_owner_nick_key, v_account_id, p_device_hash)
  on conflict (league_id, nick_key) do nothing;

  return jsonb_build_object('code', v_code, 'name', trim(p_name))
    || public.activate_game_league_if_eligible(v_id);
end;
$$;

create or replace function public.join_game_league(
  p_code text,
  p_nick_key text,
  p_device_hash text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_league public.game_leagues%rowtype;
  v_account_id uuid;
  v_state jsonb;
begin
  select * into v_league
  from public.game_leagues
  where code = upper(trim(p_code))
  for update;

  if not found then return jsonb_build_object('error', 'league_not_found'); end if;
  if v_league.activated_at is not null and v_league.ends_at <= clock_timestamp() then
    return jsonb_build_object('error', 'league_finished');
  end if;

  select account_player.account_id into v_account_id
  from public.game_account_players account_player
  where account_player.nick_key = p_nick_key;

  if v_account_id is null then
    return jsonb_build_object('error', 'player_access_denied');
  end if;

  insert into public.game_league_members(league_id, nick_key, account_id, device_hash)
  values (v_league.id, p_nick_key, v_account_id, p_device_hash)
  on conflict (league_id, nick_key) do update
    set account_id = coalesce(public.game_league_members.account_id, excluded.account_id),
        device_hash = coalesce(public.game_league_members.device_hash, excluded.device_hash);

  v_state := public.activate_game_league_if_eligible(v_league.id);
  return jsonb_build_object('code', v_league.code, 'name', v_league.name) || v_state;
end;
$$;

create or replace function public.join_game_league(p_code text, p_nick_key text)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object('error', 'league_device_required');
$$;

create or replace function public.get_game_league(p_code text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
with selected_league as (
  select league.*
  from public.game_leagues league
  where league.code = upper(trim(p_code))
), member_stats as (
  select member.nick_key, player.nick, member.joined_at,
    count(attempt.id)::integer as attempts_used,
    count(attempt.id) filter (where attempt.verified = true)::integer as verified_attempts,
    min(attempt.difference_ms) filter (where attempt.verified = true)::integer as best_difference_ms
  from selected_league league
  join public.game_league_members member on member.league_id = league.id
  join public.game_players player on player.nick_key = member.nick_key
  left join public.game_attempts attempt on attempt.league_id = league.id and attempt.nick_key = member.nick_key
  group by member.nick_key, player.nick, member.joined_at
), ranked as (
  select *, case when best_difference_ms is null then null else
    dense_rank() over(order by best_difference_ms, joined_at, nick_key)::integer end as rank
  from member_stats
), revision as (
  select max(changed_at) as changed_at
  from (
    select league.created_at as changed_at from selected_league league
    union all select league.activated_at from selected_league league where league.activated_at is not null
    union all select member.joined_at from selected_league league join public.game_league_members member on member.league_id = league.id
    union all select attempt.created_at from selected_league league join public.game_attempts attempt on attempt.league_id = league.id
    union all select trophy.awarded_at from selected_league league join public.game_league_trophies trophy on trophy.league_id = league.id
  ) changes
)
select coalesce((
  select jsonb_build_object(
    'code', league.code,
    'name', league.name,
    'createdAt', league.created_at,
    'members', (select count(*)::integer from ranked),
    'totalAttempts', (select coalesce(sum(attempts_used), 0)::integer from ranked),
    'revision', floor(extract(epoch from revision.changed_at) * 1000)::bigint,
    'champion', (
      select jsonb_build_object(
        'nick', player.nick,
        'bestDifferenceMs', trophy.best_difference_ms,
        'awardedAt', trophy.awarded_at
      )
      from public.game_league_trophies trophy
      join public.game_players player on player.nick_key = trophy.nick_key
      where trophy.league_id = league.id
    ),
    'leaderboard', coalesce((
      select jsonb_agg(jsonb_build_object(
        'nick', nick,
        'rank', rank,
        'bestDifferenceMs', best_difference_ms,
        'attemptsUsed', attempts_used,
        'verifiedAttempts', verified_attempts
      ) order by rank nulls last, joined_at, nick)
      from ranked
    ), '[]'::jsonb)
  ) || public.activate_game_league_if_eligible(league.id)
  from selected_league league
  cross join revision
), '{}'::jsonb);
$$;

create or replace function public.get_game_league_player_status(
  p_code text,
  p_nick_key text
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_league public.game_leagues%rowtype;
  v_attempts integer;
  v_verified integer;
  v_best integer;
  v_rank integer;
  v_history jsonb;
  v_state jsonb;
begin
  select * into v_league from public.game_leagues where code = upper(trim(p_code));
  if not found then return jsonb_build_object('error', 'league_not_found'); end if;
  if not exists (
    select 1 from public.game_league_members where league_id = v_league.id and nick_key = p_nick_key
  ) then
    return jsonb_build_object('error', 'league_membership_required');
  end if;

  select count(*)::integer,
    count(*) filter (where verified = true)::integer,
    min(difference_ms) filter (where verified = true)::integer
  into v_attempts, v_verified, v_best
  from public.game_attempts
  where league_id = v_league.id and nick_key = p_nick_key;

  with member_best as (
    select member.nick_key, member.joined_at,
      min(attempt.difference_ms) filter (where attempt.verified = true)::integer as best_difference_ms
    from public.game_league_members member
    left join public.game_attempts attempt
      on attempt.league_id = member.league_id and attempt.nick_key = member.nick_key
    where member.league_id = v_league.id
    group by member.nick_key, member.joined_at
  ), ranked as (
    select nick_key, case when best_difference_ms is null then null else
      dense_rank() over(order by best_difference_ms, joined_at, nick_key)::integer end as rank
    from member_best
  )
  select rank into v_rank from ranked where nick_key = p_nick_key;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', history.id,
    'team', history.team,
    'elapsedMs', history.client_elapsed_ms,
    'differenceMs', history.difference_ms,
    'verified', history.verified,
    'createdAt', history.created_at
  ) order by history.created_at desc), '[]'::jsonb)
  into v_history
  from (
    select * from public.game_attempts
    where league_id = v_league.id and nick_key = p_nick_key
    order by created_at desc limit 10
  ) history;

  v_state := public.activate_game_league_if_eligible(v_league.id);
  return jsonb_build_object(
    'member', true,
    'code', v_league.code,
    'name', v_league.name,
    'attemptsUsed', v_attempts,
    'attemptsLeft', greatest(0, 5 - v_attempts),
    'maxAttempts', 5,
    'verifiedAttempts', v_verified,
    'bestDifferenceMs', v_best,
    'rank', v_rank,
    'history', v_history
  ) || v_state;
end;
$$;

create or replace function public.get_game_player_leagues(p_nick_key text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
with memberships as (
  select league.*, owner.nick as owner_nick
  from public.game_league_members mine
  join public.game_leagues league on league.id = mine.league_id
  join public.game_players owner on owner.nick_key = league.owner_nick_key
  where mine.nick_key = p_nick_key
), member_best as (
  select member.league_id, member.nick_key, member.joined_at,
    min(attempt.difference_ms) filter (where attempt.verified = true)::integer as best_difference_ms
  from public.game_league_members member
  join memberships league on league.id = member.league_id
  left join public.game_attempts attempt
    on attempt.league_id = member.league_id and attempt.nick_key = member.nick_key
  group by member.league_id, member.nick_key, member.joined_at
), ranked as (
  select league_id, nick_key, case when best_difference_ms is null then null else
    dense_rank() over(partition by league_id order by best_difference_ms, joined_at, nick_key)::integer end as rank
  from member_best
), summaries as (
  select league.id,
    count(attempt.id)::integer as attempts_used,
    count(attempt.id) filter (where attempt.verified = true)::integer as verified_attempts,
    min(attempt.difference_ms) filter (where attempt.verified = true)::integer as best_difference_ms
  from memberships league
  left join public.game_attempts attempt on attempt.league_id = league.id and attempt.nick_key = p_nick_key
  group by league.id
)
select coalesce(jsonb_agg(
  jsonb_build_object(
    'code', league.code,
    'name', league.name,
    'ownerNick', league.owner_nick,
    'isOwner', league.owner_nick_key = p_nick_key,
    'createdAt', league.created_at,
    'members', (select count(*)::integer from public.game_league_members member where member.league_id = league.id),
    'attemptsUsed', summary.attempts_used,
    'attemptsLeft', greatest(0, 5 - summary.attempts_used),
    'maxAttempts', 5,
    'verifiedAttempts', summary.verified_attempts,
    'bestDifferenceMs', summary.best_difference_ms,
    'rank', ranked.rank,
    'revision', floor(extract(epoch from coalesce((
      select max(changed_at)
      from (
        select league.created_at as changed_at
        union all select league.activated_at where league.activated_at is not null
        union all select member.joined_at from public.game_league_members member where member.league_id = league.id
        union all select attempt.created_at from public.game_attempts attempt where attempt.league_id = league.id
        union all select trophy.awarded_at from public.game_league_trophies trophy where trophy.league_id = league.id
      ) changes
    ), league.created_at)) * 1000)::bigint,
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', history.id,
        'team', history.team,
        'elapsedMs', history.client_elapsed_ms,
        'differenceMs', history.difference_ms,
        'verified', history.verified,
        'createdAt', history.created_at
      ) order by history.created_at desc)
      from (
        select * from public.game_attempts
        where league_id = league.id and nick_key = p_nick_key
        order by created_at desc limit 10
      ) history
    ), '[]'::jsonb)
  ) || public.activate_game_league_if_eligible(league.id)
  order by (league.activated_at is null) desc,
    (league.activated_at is not null and league.ends_at > clock_timestamp()) desc,
    league.created_at desc
), '[]'::jsonb)
from memberships league
join summaries summary on summary.id = league.id
left join ranked on ranked.league_id = league.id and ranked.nick_key = p_nick_key;
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
  v_challenge_id uuid;
  v_league public.game_leagues%rowtype;
begin
  if nullif(trim(coalesce(p_league_code, '')), '') is not null then
    select * into v_league
    from public.game_leagues
    where code = upper(trim(p_league_code));

    if not found then return jsonb_build_object('error', 'league_not_found'); end if;
    if v_league.activated_at is null then
      return jsonb_build_object('error', 'league_waiting')
        || public.activate_game_league_if_eligible(v_league.id);
    end if;
    if v_league.ends_at <= clock_timestamp() then
      return jsonb_build_object('error', 'league_finished');
    end if;
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

create or replace function public.sync_game_league_trophies()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_league record;
  v_state jsonb;
  v_winner record;
  v_inserted integer := 0;
begin
  for v_league in
    select league.id
    from public.game_leagues league
    where league.activated_at is not null
      and league.ends_at <= clock_timestamp()
      and not exists (
        select 1 from public.game_league_trophies trophy where trophy.league_id = league.id
      )
    order by league.ends_at, league.id
  loop
    perform pg_advisory_xact_lock(hashtextextended(v_league.id::text, 106));

    if exists (select 1 from public.game_league_trophies where league_id = v_league.id) then
      continue;
    end if;

    v_state := public.get_game_league_activation_state(v_league.id);
    if not coalesce((v_state->>'eligible')::boolean, false) then
      continue;
    end if;

    select attempt.id, attempt.nick_key, attempt.difference_ms
    into v_winner
    from public.game_attempts attempt
    where attempt.league_id = v_league.id
      and attempt.verified = true
    order by attempt.difference_ms, attempt.created_at, attempt.nick_key, attempt.id
    limit 1;

    if not found then
      continue;
    end if;

    insert into public.game_league_trophies(
      league_id,
      nick_key,
      winning_attempt_id,
      best_difference_ms,
      participant_count,
      owner_count,
      device_count
    ) values (
      v_league.id,
      v_winner.nick_key,
      v_winner.id,
      v_winner.difference_ms,
      (v_state->>'participantCount')::integer,
      (v_state->>'eligibleOwners')::integer,
      (v_state->>'eligibleDevices')::integer
    ) on conflict (league_id) do nothing;

    if found then
      v_inserted := v_inserted + 1;
    end if;
  end loop;

  return v_inserted;
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
    union all select bonus.updated_at
      from public.game_player_bonus bonus where bonus.nick_key = p_nick_key
    union all select referral.completed_at
      from public.game_referrals referral
      where referral.referrer_nick_key = p_nick_key and referral.completed_at is not null
    union all select trophy.awarded_at
      from public.game_daily_trophies trophy where trophy.nick_key = p_nick_key
    union all select achievement.awarded_at
      from public.game_player_achievements achievement where achievement.nick_key = p_nick_key
    union all select trophy.awarded_at
      from public.game_league_trophies trophy where trophy.nick_key = p_nick_key
  ) changes;
$$;

create or replace function public.get_game_public_profile(p_nick_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile jsonb;
  v_team text;
  v_daily_total integer;
  v_league_total integer;
  v_history jsonb;
begin
  perform public.sync_game_league_trophies();
  v_profile := public.get_game_player_profile(p_nick_key);

  select attempt.team into v_team
  from public.game_attempts attempt
  where attempt.nick_key = p_nick_key
    and attempt.verified = true
    and attempt.league_id is null
  order by attempt.created_at desc, attempt.id desc
  limit 1;

  select count(*)::integer into v_daily_total
  from public.game_daily_trophies trophy
  where trophy.nick_key = p_nick_key;

  select count(*)::integer into v_league_total
  from public.game_league_trophies trophy
  where trophy.nick_key = p_nick_key;

  select coalesce(jsonb_agg(history.item order by history.sort_at desc, history.sort_key), '[]'::jsonb)
  into v_history
  from (
    select jsonb_build_object(
      'type', trophy.trophy_type,
      'date', trophy.award_date,
      'value', trophy.metric_value,
      'attempts', trophy.attempt_count,
      'bestDifferenceMs', trophy.best_difference_ms,
      'averageDifferenceMs', trophy.average_difference_ms
    ) as item,
    trophy.awarded_at as sort_at,
    trophy.trophy_type as sort_key
    from public.game_daily_trophies trophy
    where trophy.nick_key = p_nick_key
    union all
    select jsonb_build_object(
      'type', 'league_champion',
      'date', (league.ends_at at time zone 'Europe/Madrid')::date,
      'value', trophy.best_difference_ms,
      'leagueCode', league.code,
      'leagueName', league.name,
      'participants', trophy.participant_count,
      'awardedAt', trophy.awarded_at
    ) as item,
    trophy.awarded_at as sort_at,
    league.code as sort_key
    from public.game_league_trophies trophy
    join public.game_leagues league on league.id = trophy.league_id
    where trophy.nick_key = p_nick_key
  ) history;

  v_profile := jsonb_set(v_profile, '{trophies,dailyTotal}', to_jsonb(coalesce(v_daily_total, 0)), true);
  v_profile := jsonb_set(v_profile, '{trophies,leagueChampion}', to_jsonb(coalesce(v_league_total, 0)), true);
  v_profile := jsonb_set(v_profile, '{trophies,total}', to_jsonb(coalesce(v_daily_total, 0) + coalesce(v_league_total, 0)), true);
  v_profile := jsonb_set(v_profile, '{trophies,history}', coalesce(v_history, '[]'::jsonb), true);

  return v_profile || jsonb_build_object(
    'team', v_team,
    'profileRevision', public.get_game_profile_revision(p_nick_key),
    'leagueTrophies', jsonb_build_object(
      'total', coalesce(v_league_total, 0),
      'history', coalesce((
        select jsonb_agg(jsonb_build_object(
          'type', 'league_champion',
          'date', (league.ends_at at time zone 'Europe/Madrid')::date,
          'value', trophy.best_difference_ms,
          'leagueCode', league.code,
          'leagueName', league.name,
          'participants', trophy.participant_count,
          'awardedAt', trophy.awarded_at
        ) order by trophy.awarded_at desc, league.code)
        from public.game_league_trophies trophy
        join public.game_leagues league on league.id = trophy.league_id
        where trophy.nick_key = p_nick_key
      ), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.get_game_league_activation_state(uuid) from public, anon, authenticated;
revoke all on function public.activate_game_league_if_eligible(uuid) from public, anon, authenticated;
revoke all on function public.create_game_league(text, text, text) from public, anon, authenticated;
revoke all on function public.join_game_league(text, text, text) from public, anon, authenticated;
revoke all on function public.join_game_league(text, text) from public, anon, authenticated, service_role;
revoke all on function public.get_game_league(text) from public, anon, authenticated;
revoke all on function public.get_game_league_player_status(text, text) from public, anon, authenticated;
revoke all on function public.get_game_player_leagues(text) from public, anon, authenticated;
revoke all on function public.start_game_challenge_pointer_only(text, text, text, text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.sync_game_league_trophies() from public, anon, authenticated;
revoke all on function public.get_game_profile_revision(text) from public, anon, authenticated;
revoke all on function public.get_game_public_profile(text) from public, anon, authenticated;

grant execute on function public.get_game_league_activation_state(uuid) to service_role;
grant execute on function public.activate_game_league_if_eligible(uuid) to service_role;
grant execute on function public.create_game_league(text, text, text) to service_role;
grant execute on function public.join_game_league(text, text, text) to service_role;
grant execute on function public.get_game_league(text) to service_role;
grant execute on function public.get_game_league_player_status(text, text) to service_role;
grant execute on function public.get_game_player_leagues(text) to service_role;
grant execute on function public.start_game_challenge_pointer_only(text, text, text, text, text, uuid, text) to service_role;
grant execute on function public.sync_game_league_trophies() to service_role;
grant execute on function public.get_game_profile_revision(text) to service_role;
grant execute on function public.get_game_public_profile(text) to service_role;
