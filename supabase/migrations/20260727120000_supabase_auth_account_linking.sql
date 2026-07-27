alter table public.game_accounts
  add column if not exists merged_into_account_id uuid references public.game_accounts(id) on delete restrict,
  add column if not exists contact_email text,
  add column if not exists contact_email_normalized text,
  add column if not exists contact_email_verified_at timestamptz,
  add column if not exists updated_at timestamptz not null default clock_timestamp();

create index if not exists game_accounts_merged_into_idx
  on public.game_accounts(merged_into_account_id)
  where merged_into_account_id is not null;

create table if not exists public.game_account_credentials (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.game_accounts(id) on delete cascade,
  token_hash text not null unique check (char_length(token_hash) >= 32),
  created_at timestamptz not null default clock_timestamp(),
  last_used_at timestamptz not null default clock_timestamp(),
  revoked_at timestamptz
);

insert into public.game_account_credentials(account_id, token_hash, created_at, last_used_at)
select account.id, account.token_hash, account.created_at, account.last_used_at
from public.game_accounts account
on conflict (token_hash) do nothing;

create index if not exists game_account_credentials_account_idx
  on public.game_account_credentials(account_id, revoked_at, last_used_at desc);

create table if not exists public.game_auth_identities (
  auth_user_id uuid primary key,
  account_id uuid not null references public.game_accounts(id) on delete restrict,
  provider text not null check (provider in ('email', 'google', 'facebook')),
  email text,
  email_normalized text,
  email_verified_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  last_authenticated_at timestamptz not null default clock_timestamp()
);

create index if not exists game_auth_identities_account_idx
  on public.game_auth_identities(account_id, last_authenticated_at desc);
create index if not exists game_auth_identities_email_idx
  on public.game_auth_identities(email_normalized)
  where email_normalized is not null;

create table if not exists public.game_account_merge_proposals (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  source_account_id uuid not null references public.game_accounts(id) on delete restrict,
  target_account_id uuid not null references public.game_accounts(id) on delete restrict,
  impact jsonb not null,
  impact_fingerprint text not null check (char_length(impact_fingerprint) = 64),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  check (source_account_id <> target_account_id)
);

create index if not exists game_account_merge_proposals_user_idx
  on public.game_account_merge_proposals(auth_user_id, created_at desc);
create index if not exists game_account_merge_proposals_expiry_idx
  on public.game_account_merge_proposals(expires_at)
  where confirmed_at is null and cancelled_at is null;

create table if not exists public.game_account_merges (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  source_account_id uuid not null references public.game_accounts(id) on delete restrict,
  target_account_id uuid not null references public.game_accounts(id) on delete restrict,
  impact jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  check (source_account_id <> target_account_id)
);

create index if not exists game_account_merges_source_idx
  on public.game_account_merges(source_account_id, created_at desc);
create index if not exists game_account_merges_target_idx
  on public.game_account_merges(target_account_id, created_at desc);

alter table public.game_leagues
  add column if not exists identity_invalidated_at timestamptz,
  add column if not exists identity_invalidation_reason text,
  add column if not exists identity_invalidated_by_merge_id uuid references public.game_account_merges(id) on delete restrict;

alter table public.game_duels
  add column if not exists identity_invalidated_at timestamptz,
  add column if not exists identity_invalidation_reason text,
  add column if not exists identity_invalidated_by_merge_id uuid references public.game_account_merges(id) on delete restrict;

alter table public.game_referrals
  add column if not exists identity_invalidated_at timestamptz,
  add column if not exists identity_invalidation_reason text,
  add column if not exists identity_invalidated_by_merge_id uuid references public.game_account_merges(id) on delete restrict;

create index if not exists game_leagues_identity_valid_idx
  on public.game_leagues(identity_invalidated_at, ends_at);
create index if not exists game_duels_identity_valid_idx
  on public.game_duels(identity_invalidated_at, completed_at);
create index if not exists game_referrals_identity_valid_idx
  on public.game_referrals(identity_invalidated_at, completed_at);

alter table public.game_account_credentials enable row level security;
alter table public.game_auth_identities enable row level security;
alter table public.game_account_merge_proposals enable row level security;
alter table public.game_account_merges enable row level security;

revoke all on table
  public.game_account_credentials,
  public.game_auth_identities,
  public.game_account_merge_proposals,
  public.game_account_merges
from public, anon, authenticated;

grant all on table
  public.game_account_credentials,
  public.game_auth_identities,
  public.game_account_merge_proposals,
  public.game_account_merges
to service_role;

create or replace function public.resolve_game_account_id(p_account_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_current uuid := p_account_id;
  v_next uuid;
  v_depth integer := 0;
begin
  while v_current is not null and v_depth < 32 loop
    select account.merged_into_account_id into v_next
    from public.game_accounts account
    where account.id = v_current;

    if not found then return null; end if;
    if v_next is null then return v_current; end if;
    v_current := v_next;
    v_depth := v_depth + 1;
  end loop;

  raise exception 'game account merge chain is invalid';
end;
$$;

create or replace function public.resolve_game_account_token(p_token_hash text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_account_id uuid;
begin
  if char_length(coalesce(p_token_hash, '')) < 32 then return null; end if;

  select credential.account_id into v_account_id
  from public.game_account_credentials credential
  where credential.token_hash = p_token_hash
    and credential.revoked_at is null
  for update;

  if not found then
    select account.id into v_account_id
    from public.game_accounts account
    where account.token_hash = p_token_hash
    for update;
  end if;

  if v_account_id is null then return null; end if;
  v_account_id := public.resolve_game_account_id(v_account_id);

  update public.game_account_credentials
  set account_id = v_account_id,
      last_used_at = clock_timestamp()
  where token_hash = p_token_hash
    and revoked_at is null;

  update public.game_accounts
  set last_used_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where id = v_account_id;

  return v_account_id;
end;
$$;

create or replace function public.game_account_nick_keys(p_account_id uuid)
returns table(nick_key text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select player.nick_key
  from public.game_account_players player
  where player.account_id = public.resolve_game_account_id(p_account_id);
$$;

create or replace function public.get_game_account_merge_impact(
  p_source_account_id uuid,
  p_target_account_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_source uuid := public.resolve_game_account_id(p_source_account_id);
  v_target uuid := public.resolve_game_account_id(p_target_account_id);
  v_leagues jsonb;
  v_trophies jsonb;
  v_achievements jsonb;
  v_duels jsonb;
  v_referrals jsonb;
  v_bonus jsonb;
  v_total integer;
begin
  if v_source is null or v_target is null or v_source = v_target then
    return jsonb_build_object(
      'leagues', '[]'::jsonb,
      'trophies', '[]'::jsonb,
      'achievements', '[]'::jsonb,
      'duels', '[]'::jsonb,
      'referrals', '[]'::jsonb,
      'bonusAdjustments', '[]'::jsonb,
      'totalLosses', 0
    );
  end if;

  with source_nicks as (
    select nick_key from public.game_account_players where account_id = v_source
  ), target_nicks as (
    select nick_key from public.game_account_players where account_id = v_target
  ), invalid_leagues as (
    select distinct league.id, league.public_id, league.name
    from public.game_leagues league
    where league.identity_invalidated_at is null
      and exists (
        select 1 from public.game_league_members member
        join source_nicks source on source.nick_key = member.nick_key
        where member.league_id = league.id
      )
      and exists (
        select 1 from public.game_league_members member
        join target_nicks target on target.nick_key = member.nick_key
        where member.league_id = league.id
      )
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'publicId', public_id,
    'name', name,
    'reason', 'Las dos cuentas ocupaban plazas independientes en esta liga.'
  ) order by name, public_id), '[]'::jsonb)
  into v_leagues
  from invalid_leagues;

  with source_nicks as (
    select nick_key from public.game_account_players where account_id = v_source
  ), target_nicks as (
    select nick_key from public.game_account_players where account_id = v_target
  ), invalid_leagues as (
    select distinct league.id, league.public_id, league.name
    from public.game_leagues league
    where league.identity_invalidated_at is null
      and exists (select 1 from public.game_league_members member join source_nicks source on source.nick_key = member.nick_key where member.league_id = league.id)
      and exists (select 1 from public.game_league_members member join target_nicks target on target.nick_key = member.nick_key where member.league_id = league.id)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'type', 'league_trophy',
    'title', 'Campeón de liga',
    'nick', player.nick,
    'leaguePublicId', league.public_id,
    'leagueName', league.name
  ) order by league.name, player.nick), '[]'::jsonb)
  into v_trophies
  from invalid_leagues league
  join public.game_league_trophies trophy on trophy.league_id = league.id
  join public.game_players player on player.nick_key = trophy.nick_key;

  with source_nicks as (
    select nick_key from public.game_account_players where account_id = v_source
  ), target_nicks as (
    select nick_key from public.game_account_players where account_id = v_target
  ), all_merged_nicks as (
    select nick_key from source_nicks union select nick_key from target_nicks
  ), invalid_leagues as (
    select distinct league.id, league.public_id
    from public.game_leagues league
    where league.identity_invalidated_at is null
      and exists (select 1 from public.game_league_members member join source_nicks source on source.nick_key = member.nick_key where member.league_id = league.id)
      and exists (select 1 from public.game_league_members member join target_nicks target on target.nick_key = member.nick_key where member.league_id = league.id)
  ), invalid_duels as (
    select duel.id
    from public.game_duels duel
    where duel.identity_invalidated_at is null
      and duel.completed_at is not null
      and (
        (duel.challenger_nick_key in (select nick_key from source_nicks) and duel.opponent_nick_key in (select nick_key from target_nicks))
        or
        (duel.challenger_nick_key in (select nick_key from target_nicks) and duel.opponent_nick_key in (select nick_key from source_nicks))
      )
  ), invalid_referrals as (
    select referral.id
    from public.game_referrals referral
    where referral.identity_invalidated_at is null
      and referral.completed_at is not null
      and (
        (referral.referrer_nick_key in (select nick_key from source_nicks) and referral.referred_nick_key in (select nick_key from target_nicks))
        or
        (referral.referrer_nick_key in (select nick_key from target_nicks) and referral.referred_nick_key in (select nick_key from source_nicks))
      )
  ), projected as (
    select achievement.*,
      case achievement.achievement_kind
        when 'league_podium' then exists (
          select 1 from invalid_leagues league
          where league.public_id = achievement.metadata->>'leaguePublicId'
        )
        when 'league_participation' then coalesce((achievement.metadata->>'threshold')::integer, 0) > (
          select count(distinct league.id)::integer
          from public.game_leagues league
          join public.game_league_trophies trophy on trophy.league_id = league.id
          where league.identity_invalidated_at is null
            and league.id not in (select id from invalid_leagues)
            and exists (
              select 1 from public.game_attempts attempt
              where attempt.league_id = league.id
                and attempt.nick_key = achievement.nick_key
                and attempt.verified = true
            )
        )
        when 'duel_wins' then coalesce((achievement.metadata->>'threshold')::integer, 0) > (
          select count(*)::integer
          from public.game_duels duel
          where duel.identity_invalidated_at is null
            and duel.id not in (select id from invalid_duels)
            and duel.completed_at is not null
            and (
              (duel.challenger_nick_key = achievement.nick_key and coalesce(duel.opponent_best_difference_ms, 2147483647) >= duel.challenger_best_difference_ms)
              or
              (duel.opponent_nick_key = achievement.nick_key and duel.opponent_best_difference_ms < duel.challenger_best_difference_ms)
            )
        )
        when 'referral_total' then coalesce((achievement.metadata->>'threshold')::integer, 0) > (
          select count(*)::integer
          from public.game_referrals referral
          where referral.referrer_nick_key = achievement.nick_key
            and referral.completed_at is not null
            and referral.identity_invalidated_at is null
            and referral.id not in (select id from invalid_referrals)
        )
        else false
      end as removed
    from public.game_player_achievements achievement
    where achievement.nick_key in (select nick_key from all_merged_nicks)
      or achievement.achievement_kind in ('league_podium', 'league_participation')
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'code', achievement_code,
    'kind', achievement_kind,
    'title', title,
    'nick', player.nick,
    'points', points
  ) order by player.nick, title, achievement_code), '[]'::jsonb)
  into v_achievements
  from projected
  join public.game_players player using (nick_key)
  where projected.removed;

  with source_nicks as (
    select nick_key from public.game_account_players where account_id = v_source
  ), target_nicks as (
    select nick_key from public.game_account_players where account_id = v_target
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', duel.id,
    'challenger', challenger.nick,
    'opponent', opponent.nick,
    'winner', winner.nick,
    'rewardAttempts', case when duel.opponent_best_difference_ms < duel.challenger_best_difference_ms then 3 else 1 end
  ) order by duel.completed_at, duel.id), '[]'::jsonb)
  into v_duels
  from public.game_duels duel
  join public.game_players challenger on challenger.nick_key = duel.challenger_nick_key
  join public.game_players opponent on opponent.nick_key = duel.opponent_nick_key
  join public.game_players winner on winner.nick_key = case
    when duel.opponent_best_difference_ms < duel.challenger_best_difference_ms then duel.opponent_nick_key
    else duel.challenger_nick_key
  end
  where duel.identity_invalidated_at is null
    and duel.completed_at is not null
    and (
      (duel.challenger_nick_key in (select nick_key from source_nicks) and duel.opponent_nick_key in (select nick_key from target_nicks))
      or
      (duel.challenger_nick_key in (select nick_key from target_nicks) and duel.opponent_nick_key in (select nick_key from source_nicks))
    );

  with source_nicks as (
    select nick_key from public.game_account_players where account_id = v_source
  ), target_nicks as (
    select nick_key from public.game_account_players where account_id = v_target
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', referral.id,
    'referrer', referrer.nick,
    'referred', referred.nick,
    'rewardAttempts', 1
  ) order by referral.completed_at, referral.id), '[]'::jsonb)
  into v_referrals
  from public.game_referrals referral
  join public.game_players referrer on referrer.nick_key = referral.referrer_nick_key
  join public.game_players referred on referred.nick_key = referral.referred_nick_key
  where referral.identity_invalidated_at is null
    and referral.completed_at is not null
    and (
      (referral.referrer_nick_key in (select nick_key from source_nicks) and referral.referred_nick_key in (select nick_key from target_nicks))
      or
      (referral.referrer_nick_key in (select nick_key from target_nicks) and referral.referred_nick_key in (select nick_key from source_nicks))
    );

  with adjustments as (
    select winner_nick_key as nick_key, sum(reward_attempts)::integer as attempts
    from (
      with source_nicks as (select nick_key from public.game_account_players where account_id = v_source),
           target_nicks as (select nick_key from public.game_account_players where account_id = v_target)
      select case when duel.opponent_best_difference_ms < duel.challenger_best_difference_ms
          then duel.opponent_nick_key else duel.challenger_nick_key end as winner_nick_key,
        case when duel.opponent_best_difference_ms < duel.challenger_best_difference_ms then 3 else 1 end as reward_attempts
      from public.game_duels duel
      where duel.identity_invalidated_at is null
        and duel.completed_at is not null
        and ((duel.challenger_nick_key in (select nick_key from source_nicks) and duel.opponent_nick_key in (select nick_key from target_nicks))
          or (duel.challenger_nick_key in (select nick_key from target_nicks) and duel.opponent_nick_key in (select nick_key from source_nicks)))
      union all
      select referral.referrer_nick_key, 1
      from public.game_referrals referral
      where referral.identity_invalidated_at is null
        and referral.completed_at is not null
        and ((referral.referrer_nick_key in (select nick_key from source_nicks) and referral.referred_nick_key in (select nick_key from target_nicks))
          or (referral.referrer_nick_key in (select nick_key from target_nicks) and referral.referred_nick_key in (select nick_key from source_nicks)))
    ) rewards
    group by winner_nick_key
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'nick', player.nick,
    'attempts', adjustments.attempts
  ) order by player.nick), '[]'::jsonb)
  into v_bonus
  from adjustments
  join public.game_players player on player.nick_key = adjustments.nick_key;

  v_total := jsonb_array_length(v_trophies)
    + jsonb_array_length(v_achievements)
    + jsonb_array_length(v_duels)
    + jsonb_array_length(v_referrals)
    + jsonb_array_length(v_bonus);

  return jsonb_build_object(
    'leagues', v_leagues,
    'trophies', v_trophies,
    'achievements', v_achievements,
    'duels', v_duels,
    'referrals', v_referrals,
    'bonusAdjustments', v_bonus,
    'totalLosses', v_total
  );
end;
$$;

create or replace function public.reconcile_game_player_identity_achievements(p_nick_key text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_removed integer := 0;
  v_count integer;
begin
  delete from public.game_player_achievements achievement
  where achievement.nick_key = p_nick_key
    and (
      (
        achievement.achievement_kind = 'league_podium'
        and not exists (
          select 1
          from public.game_leagues league
          join public.game_league_trophies trophy on trophy.league_id = league.id
          where league.public_id = achievement.metadata->>'leaguePublicId'
            and league.identity_invalidated_at is null
            and trophy.nick_key = achievement.nick_key
        )
      )
      or (
        achievement.achievement_kind = 'league_participation'
        and coalesce((achievement.metadata->>'threshold')::integer, 0) > (
          select count(distinct league.id)::integer
          from public.game_leagues league
          join public.game_league_trophies trophy on trophy.league_id = league.id
          where league.identity_invalidated_at is null
            and exists (
              select 1 from public.game_attempts attempt
              where attempt.league_id = league.id
                and attempt.nick_key = p_nick_key
                and attempt.verified = true
            )
        )
      )
      or (
        achievement.achievement_kind = 'duel_wins'
        and coalesce((achievement.metadata->>'threshold')::integer, 0) > (
          select count(*)::integer
          from public.game_duels duel
          where duel.identity_invalidated_at is null
            and duel.completed_at is not null
            and (
              (duel.challenger_nick_key = p_nick_key and coalesce(duel.opponent_best_difference_ms, 2147483647) >= duel.challenger_best_difference_ms)
              or
              (duel.opponent_nick_key = p_nick_key and duel.opponent_best_difference_ms < duel.challenger_best_difference_ms)
            )
        )
      )
      or (
        achievement.achievement_kind = 'referral_total'
        and coalesce((achievement.metadata->>'threshold')::integer, 0) > (
          select count(*)::integer
          from public.game_referrals referral
          where referral.referrer_nick_key = p_nick_key
            and referral.completed_at is not null
            and referral.identity_invalidated_at is null
        )
      )
    );
  get diagnostics v_count = row_count;
  v_removed := v_removed + v_count;

  update public.game_player_featured_achievements featured
  set active = false,
      updated_at = clock_timestamp()
  where featured.nick_key = p_nick_key
    and featured.active = true
    and not exists (
      select 1 from public.game_player_achievements achievement
      where achievement.nick_key = featured.nick_key
        and achievement.achievement_code = featured.achievement_code
    );

  return v_removed;
end;
$$;

alter function public.refresh_game_player_progression_achievements(text)
  rename to refresh_game_player_progression_achievements_unfiltered;

create or replace function public.refresh_game_player_progression_achievements(p_nick_key text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inserted integer;
begin
  v_inserted := public.refresh_game_player_progression_achievements_unfiltered(p_nick_key);
  perform public.reconcile_game_player_identity_achievements(p_nick_key);
  return v_inserted;
end;
$$;

create or replace function public.merge_game_accounts_internal(
  p_auth_user_id uuid,
  p_source_account_id uuid,
  p_target_account_id uuid,
  p_impact jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source uuid := public.resolve_game_account_id(p_source_account_id);
  v_target uuid := public.resolve_game_account_id(p_target_account_id);
  v_merge_id uuid;
  v_now timestamptz := clock_timestamp();
  v_nick text;
  v_adjustment record;
begin
  if v_source is null or v_target is null then return jsonb_build_object('error', 'account_not_found'); end if;
  if v_source = v_target then return jsonb_build_object('merged', true, 'accountId', v_target, 'alreadyMerged', true); end if;

  perform pg_advisory_xact_lock(hashtextextended(least(v_source::text, v_target::text), 10641));
  perform pg_advisory_xact_lock(hashtextextended(greatest(v_source::text, v_target::text), 10641));

  v_source := public.resolve_game_account_id(v_source);
  v_target := public.resolve_game_account_id(v_target);
  if v_source = v_target then return jsonb_build_object('merged', true, 'accountId', v_target, 'alreadyMerged', true); end if;

  insert into public.game_account_merges(auth_user_id, source_account_id, target_account_id, impact)
  values (p_auth_user_id, v_source, v_target, coalesce(p_impact, '{}'::jsonb))
  returning id into v_merge_id;

  with source_nicks as (
    select nick_key from public.game_account_players where account_id = v_source
  ), target_nicks as (
    select nick_key from public.game_account_players where account_id = v_target
  )
  update public.game_leagues league
  set identity_invalidated_at = v_now,
      identity_invalidation_reason = 'merged_accounts_were_independent_members',
      identity_invalidated_by_merge_id = v_merge_id
  where league.identity_invalidated_at is null
    and exists (select 1 from public.game_league_members member join source_nicks source on source.nick_key = member.nick_key where member.league_id = league.id)
    and exists (select 1 from public.game_league_members member join target_nicks target on target.nick_key = member.nick_key where member.league_id = league.id);

  with source_nicks as (
    select nick_key from public.game_account_players where account_id = v_source
  ), target_nicks as (
    select nick_key from public.game_account_players where account_id = v_target
  )
  update public.game_duels duel
  set identity_invalidated_at = v_now,
      identity_invalidation_reason = 'merged_accounts_faced_each_other',
      identity_invalidated_by_merge_id = v_merge_id
  where duel.identity_invalidated_at is null
    and duel.completed_at is not null
    and ((duel.challenger_nick_key in (select nick_key from source_nicks) and duel.opponent_nick_key in (select nick_key from target_nicks))
      or (duel.challenger_nick_key in (select nick_key from target_nicks) and duel.opponent_nick_key in (select nick_key from source_nicks)));

  with source_nicks as (
    select nick_key from public.game_account_players where account_id = v_source
  ), target_nicks as (
    select nick_key from public.game_account_players where account_id = v_target
  )
  update public.game_referrals referral
  set identity_invalidated_at = v_now,
      identity_invalidation_reason = 'merged_accounts_referred_each_other',
      identity_invalidated_by_merge_id = v_merge_id
  where referral.identity_invalidated_at is null
    and referral.completed_at is not null
    and ((referral.referrer_nick_key in (select nick_key from source_nicks) and referral.referred_nick_key in (select nick_key from target_nicks))
      or (referral.referrer_nick_key in (select nick_key from target_nicks) and referral.referred_nick_key in (select nick_key from source_nicks)));

  for v_adjustment in
    select winner_nick_key as nick_key, sum(reward_attempts)::integer as attempts
    from (
      select case when duel.opponent_best_difference_ms < duel.challenger_best_difference_ms
          then duel.opponent_nick_key else duel.challenger_nick_key end as winner_nick_key,
        case when duel.opponent_best_difference_ms < duel.challenger_best_difference_ms then 3 else 1 end as reward_attempts
      from public.game_duels duel
      where duel.identity_invalidated_by_merge_id = v_merge_id
      union all
      select referral.referrer_nick_key, 1
      from public.game_referrals referral
      where referral.identity_invalidated_by_merge_id = v_merge_id
    ) rewards
    group by winner_nick_key
  loop
    update public.game_player_bonus
    set bonus_attempts = greatest(0, bonus_attempts - v_adjustment.attempts),
        updated_at = v_now
    where nick_key = v_adjustment.nick_key;
  end loop;

  delete from public.game_league_trophies trophy
  using public.game_leagues league
  where trophy.league_id = league.id
    and league.identity_invalidated_by_merge_id = v_merge_id;

  update public.game_account_players
  set account_id = v_target,
      linked_at = least(linked_at, v_now)
  where account_id = v_source;

  update public.game_league_members
  set account_id = v_target
  where account_id = v_source;

  update public.game_account_credentials
  set account_id = v_target,
      last_used_at = v_now
  where account_id = v_source;

  update public.game_auth_identities
  set account_id = v_target,
      last_authenticated_at = v_now
  where account_id = v_source;

  update public.game_accounts source
  set merged_into_account_id = v_target,
      updated_at = v_now,
      last_used_at = v_now
  where source.id = v_source;

  update public.game_accounts target
  set contact_email = coalesce(target.contact_email, source.contact_email),
      contact_email_normalized = coalesce(target.contact_email_normalized, source.contact_email_normalized),
      contact_email_verified_at = coalesce(target.contact_email_verified_at, source.contact_email_verified_at),
      updated_at = v_now,
      last_used_at = v_now
  from public.game_accounts source
  where target.id = v_target and source.id = v_source;

  for v_nick in
    select nick_key from public.game_account_players where account_id = v_target
  loop
    perform public.refresh_game_player_progression_achievements(v_nick);
  end loop;

  for v_nick in
    select distinct member.nick_key
    from public.game_league_members member
    join public.game_leagues league on league.id = member.league_id
    where league.identity_invalidated_by_merge_id = v_merge_id
  loop
    perform public.refresh_game_player_progression_achievements(v_nick);
  end loop;

  return jsonb_build_object(
    'merged', true,
    'accountId', v_target,
    'mergeId', v_merge_id,
    'impact', p_impact
  );
end;
$$;

create or replace function public.prepare_game_auth_link(
  p_auth_user_id uuid,
  p_provider text,
  p_email text,
  p_email_verified boolean,
  p_account_token_hash text,
  p_new_token_hash text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity public.game_auth_identities%rowtype;
  v_identity_account uuid;
  v_local_account uuid;
  v_new_account uuid;
  v_email text := nullif(trim(coalesce(p_email, '')), '');
  v_email_normalized text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_now timestamptz := clock_timestamp();
  v_impact jsonb;
  v_fingerprint text;
  v_proposal_id uuid;
  v_merge jsonb;
begin
  if p_auth_user_id is null
     or p_provider not in ('email', 'google', 'facebook')
     or char_length(coalesce(p_new_token_hash, '')) < 32 then
    return jsonb_build_object('error', 'invalid_input');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_auth_user_id::text, 10642));

  select * into v_identity
  from public.game_auth_identities identity
  where identity.auth_user_id = p_auth_user_id
  for update;

  if found then v_identity_account := public.resolve_game_account_id(v_identity.account_id); end if;
  if char_length(coalesce(p_account_token_hash, '')) >= 32 then
    v_local_account := public.resolve_game_account_token(p_account_token_hash);
  end if;

  if v_identity_account is null and v_local_account is null then
    insert into public.game_accounts(
      token_hash, contact_email, contact_email_normalized, contact_email_verified_at, updated_at
    ) values (
      p_new_token_hash,
      v_email,
      v_email_normalized,
      case when p_email_verified then v_now else null end,
      v_now
    ) returning id into v_new_account;

    insert into public.game_account_credentials(account_id, token_hash)
    values (v_new_account, p_new_token_hash)
    on conflict (token_hash) do update set account_id = excluded.account_id, last_used_at = v_now;

    insert into public.game_auth_identities(
      auth_user_id, account_id, provider, email, email_normalized, email_verified_at
    ) values (
      p_auth_user_id, v_new_account, p_provider, v_email, v_email_normalized,
      case when p_email_verified then v_now else null end
    );

    return jsonb_build_object('linked', true, 'created', true, 'accountId', v_new_account, 'issueToken', true);
  end if;

  if v_identity_account is null then
    insert into public.game_auth_identities(
      auth_user_id, account_id, provider, email, email_normalized, email_verified_at
    ) values (
      p_auth_user_id, v_local_account, p_provider, v_email, v_email_normalized,
      case when p_email_verified then v_now else null end
    );
    v_identity_account := v_local_account;
  else
    update public.game_auth_identities
    set account_id = v_identity_account,
        provider = p_provider,
        email = v_email,
        email_normalized = v_email_normalized,
        email_verified_at = case when p_email_verified then coalesce(email_verified_at, v_now) else email_verified_at end,
        last_authenticated_at = v_now
    where auth_user_id = p_auth_user_id;
  end if;

  update public.game_accounts
  set contact_email = coalesce(v_email, contact_email),
      contact_email_normalized = coalesce(v_email_normalized, contact_email_normalized),
      contact_email_verified_at = case when p_email_verified then coalesce(contact_email_verified_at, v_now) else contact_email_verified_at end,
      last_used_at = v_now,
      updated_at = v_now
  where id = v_identity_account;

  if v_local_account is null then
    insert into public.game_account_credentials(account_id, token_hash)
    values (v_identity_account, p_new_token_hash)
    on conflict (token_hash) do update
      set account_id = excluded.account_id,
          last_used_at = v_now,
          revoked_at = null;
    return jsonb_build_object('linked', true, 'recovered', true, 'accountId', v_identity_account, 'issueToken', true);
  end if;

  if v_local_account = v_identity_account then
    return jsonb_build_object('linked', true, 'accountId', v_identity_account, 'issueToken', false);
  end if;

  v_impact := public.get_game_account_merge_impact(v_local_account, v_identity_account);
  v_fingerprint := encode(digest(convert_to(v_impact::text, 'UTF8'), 'sha256'), 'hex');

  if coalesce((v_impact->>'totalLosses')::integer, 0) = 0 then
    v_merge := public.merge_game_accounts_internal(
      p_auth_user_id,
      v_local_account,
      v_identity_account,
      v_impact
    );
    return v_merge || jsonb_build_object('linked', true, 'issueToken', false);
  end if;

  update public.game_account_merge_proposals
  set cancelled_at = v_now
  where auth_user_id = p_auth_user_id
    and confirmed_at is null
    and cancelled_at is null;

  insert into public.game_account_merge_proposals(
    auth_user_id, source_account_id, target_account_id,
    impact, impact_fingerprint, expires_at
  ) values (
    p_auth_user_id, v_local_account, v_identity_account,
    v_impact, v_fingerprint, v_now + interval '10 minutes'
  ) returning id into v_proposal_id;

  return jsonb_build_object(
    'linked', false,
    'mergeRequired', true,
    'proposalId', v_proposal_id,
    'fingerprint', v_fingerprint,
    'expiresAt', v_now + interval '10 minutes',
    'impact', v_impact
  );
end;
$$;

create or replace function public.confirm_game_auth_merge(
  p_auth_user_id uuid,
  p_proposal_id uuid,
  p_impact_fingerprint text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_proposal public.game_account_merge_proposals%rowtype;
  v_impact jsonb;
  v_fingerprint text;
  v_result jsonb;
  v_now timestamptz := clock_timestamp();
begin
  perform pg_advisory_xact_lock(hashtextextended(p_auth_user_id::text, 10642));

  select * into v_proposal
  from public.game_account_merge_proposals proposal
  where proposal.id = p_proposal_id
    and proposal.auth_user_id = p_auth_user_id
  for update;

  if not found then return jsonb_build_object('error', 'merge_proposal_not_found'); end if;
  if v_proposal.confirmed_at is not null then
    return jsonb_build_object(
      'merged', true,
      'accountId', public.resolve_game_account_id(v_proposal.target_account_id),
      'alreadyMerged', true
    );
  end if;
  if v_proposal.cancelled_at is not null then return jsonb_build_object('error', 'merge_proposal_cancelled'); end if;
  if v_proposal.expires_at <= v_now then return jsonb_build_object('error', 'merge_proposal_expired'); end if;
  if v_proposal.impact_fingerprint <> p_impact_fingerprint then return jsonb_build_object('error', 'merge_proposal_mismatch'); end if;

  v_impact := public.get_game_account_merge_impact(v_proposal.source_account_id, v_proposal.target_account_id);
  v_fingerprint := encode(digest(convert_to(v_impact::text, 'UTF8'), 'sha256'), 'hex');
  if v_fingerprint <> v_proposal.impact_fingerprint then
    update public.game_account_merge_proposals
    set cancelled_at = v_now
    where id = v_proposal.id;
    return jsonb_build_object('error', 'merge_proposal_stale', 'impact', v_impact);
  end if;

  v_result := public.merge_game_accounts_internal(
    p_auth_user_id,
    v_proposal.source_account_id,
    v_proposal.target_account_id,
    v_impact
  );

  if v_result ? 'error' then return v_result; end if;

  update public.game_account_merge_proposals
  set confirmed_at = v_now
  where id = v_proposal.id;

  return v_result;
end;
$$;

create or replace function public.cancel_game_auth_merge(
  p_auth_user_id uuid,
  p_proposal_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.game_account_merge_proposals
  set cancelled_at = clock_timestamp()
  where id = p_proposal_id
    and auth_user_id = p_auth_user_id
    and confirmed_at is null
    and cancelled_at is null;

  if found then return jsonb_build_object('cancelled', true); end if;
  return jsonb_build_object('error', 'merge_proposal_not_found');
end;
$$;

create or replace function public.ensure_game_account_player(
  p_nick text,
  p_nick_key text,
  p_device_hash text,
  p_ip_hash text,
  p_account_token_hash text,
  p_legacy_token_hash text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_account_id uuid;
  v_player public.game_players%rowtype;
  v_link public.game_account_players%rowtype;
begin
  if char_length(p_nick) not between 2 and 24
     or char_length(p_nick_key) not between 2 and 24
     or char_length(coalesce(p_account_token_hash, '')) < 32 then
    return jsonb_build_object('error', 'invalid_input');
  end if;

  v_account_id := public.resolve_game_account_token(p_account_token_hash);
  if v_account_id is null then
    insert into public.game_accounts(token_hash)
    values (p_account_token_hash)
    on conflict (token_hash) do update set last_used_at = clock_timestamp()
    returning id into v_account_id;

    v_account_id := public.resolve_game_account_id(v_account_id);
    insert into public.game_account_credentials(account_id, token_hash)
    values (v_account_id, p_account_token_hash)
    on conflict (token_hash) do update
      set account_id = excluded.account_id,
          last_used_at = clock_timestamp(),
          revoked_at = null;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_nick_key, 106));
  select * into v_player
  from public.game_players
  where nick_key = p_nick_key
  for update;

  if not found then
    insert into public.game_players(
      nick_key, nick, first_device_hash, first_ip_hash,
      access_token_hash, access_token_created_at
    ) values (
      p_nick_key, p_nick, p_device_hash, p_ip_hash,
      p_account_token_hash, clock_timestamp()
    ) returning * into v_player;

    insert into public.game_player_bonus(nick_key)
    values (p_nick_key)
    on conflict (nick_key) do nothing;

    insert into public.game_account_players(account_id, nick_key)
    values (v_account_id, p_nick_key);

    return jsonb_build_object('authorized', true, 'created', true, 'linked', true);
  end if;

  select * into v_link
  from public.game_account_players
  where nick_key = p_nick_key;

  if found then
    if public.resolve_game_account_id(v_link.account_id) <> v_account_id then
      return jsonb_build_object('error', 'player_access_denied');
    end if;
    if v_link.account_id <> v_account_id then
      update public.game_account_players set account_id = v_account_id where nick_key = p_nick_key;
    end if;
    update public.game_players set nick = p_nick where nick_key = p_nick_key;
    return jsonb_build_object('authorized', true, 'created', false, 'linked', true);
  end if;

  if v_player.access_token_hash = p_account_token_hash
     or (p_legacy_token_hash is not null and v_player.access_token_hash = p_legacy_token_hash)
     or (v_player.access_token_hash is null and v_player.first_device_hash = p_device_hash) then
    insert into public.game_account_players(account_id, nick_key)
    values (v_account_id, p_nick_key);

    update public.game_players
    set access_token_hash = p_account_token_hash,
        access_token_created_at = coalesce(access_token_created_at, clock_timestamp())
    where nick_key = p_nick_key;

    return jsonb_build_object('authorized', true, 'created', false, 'linked', true, 'claimed', true);
  end if;

  return jsonb_build_object('error', 'player_access_denied');
exception
  when unique_violation then
    return jsonb_build_object('error', 'player_access_denied');
end;
$$;

create or replace function public.get_game_account_players(p_account_token_hash text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with selected_account as (
    select public.resolve_game_account_token(p_account_token_hash) as id
  ), attempt_summary as (
    select
      attempt.nick_key,
      count(*)::integer as attempts_used,
      count(*) filter (where attempt.verified)::integer as verified_attempts,
      min(attempt.difference_ms) filter (where attempt.verified)::integer as best_difference_ms,
      round(avg(attempt.difference_ms) filter (where attempt.verified))::integer as average_difference_ms,
      (array_agg(attempt.team order by attempt.created_at desc))[1] as team
    from public.game_attempts attempt
    join public.game_account_players account_player on account_player.nick_key = attempt.nick_key
    join selected_account account on account.id = account_player.account_id
    group by attempt.nick_key
  )
  select jsonb_build_object(
    'exists', exists(select 1 from selected_account where id is not null),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'nick', player.nick,
        'nickKey', player.nick_key,
        'team', summary.team,
        'attemptsUsed', coalesce(summary.attempts_used, 0),
        'verifiedAttempts', coalesce(summary.verified_attempts, 0),
        'bestDifferenceMs', summary.best_difference_ms,
        'averageDifferenceMs', summary.average_difference_ms,
        'bonusAttempts', coalesce(bonus.bonus_attempts, 0),
        'attemptsLeft', greatest(0, 5 + coalesce(bonus.bonus_attempts, 0) - coalesce(summary.attempts_used, 0)),
        'linkedAt', account_player.linked_at
      ) order by account_player.linked_at desc)
      from selected_account selected
      join public.game_account_players account_player on account_player.account_id = selected.id
      join public.game_players player on player.nick_key = account_player.nick_key
      left join attempt_summary summary on summary.nick_key = player.nick_key
      left join public.game_player_bonus bonus on bonus.nick_key = player.nick_key
      where selected.id is not null
    ), '[]'::jsonb)
  );
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
      and league.identity_invalidated_at is null
      and not exists (select 1 from public.game_league_trophies trophy where trophy.league_id = league.id)
    order by league.ends_at, league.id
  loop
    perform pg_advisory_xact_lock(hashtextextended(v_league.id::text, 106));
    if exists (select 1 from public.game_league_trophies where league_id = v_league.id) then continue; end if;

    v_state := public.get_game_league_activation_state(v_league.id);
    if not coalesce((v_state->>'eligible')::boolean, false) then continue; end if;

    select attempt.id, attempt.nick_key, attempt.difference_ms
    into v_winner
    from public.game_attempts attempt
    where attempt.league_id = v_league.id and attempt.verified = true
    order by attempt.difference_ms, attempt.created_at, attempt.nick_key, attempt.id
    limit 1;
    if not found then continue; end if;

    insert into public.game_league_trophies(
      league_id, nick_key, winning_attempt_id, best_difference_ms,
      participant_count, owner_count, device_count
    ) values (
      v_league.id, v_winner.nick_key, v_winner.id, v_winner.difference_ms,
      (v_state->>'participantCount')::integer,
      (v_state->>'eligibleOwners')::integer,
      (v_state->>'eligibleDevices')::integer
    ) on conflict (league_id) do nothing;

    if found then v_inserted := v_inserted + 1; end if;
  end loop;
  return v_inserted;
end;
$$;

revoke all on function public.resolve_game_account_id(uuid) from public, anon, authenticated;
revoke all on function public.resolve_game_account_token(text) from public, anon, authenticated;
revoke all on function public.game_account_nick_keys(uuid) from public, anon, authenticated;
revoke all on function public.get_game_account_merge_impact(uuid,uuid) from public, anon, authenticated;
revoke all on function public.reconcile_game_player_identity_achievements(text) from public, anon, authenticated;
revoke all on function public.refresh_game_player_progression_achievements_unfiltered(text) from public, anon, authenticated;
revoke all on function public.refresh_game_player_progression_achievements(text) from public, anon, authenticated;
revoke all on function public.merge_game_accounts_internal(uuid,uuid,uuid,jsonb) from public, anon, authenticated;
revoke all on function public.prepare_game_auth_link(uuid,text,text,boolean,text,text) from public, anon, authenticated;
revoke all on function public.confirm_game_auth_merge(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.cancel_game_auth_merge(uuid,uuid) from public, anon, authenticated;
revoke all on function public.ensure_game_account_player(text,text,text,text,text,text) from public, anon, authenticated;
revoke all on function public.get_game_account_players(text) from public, anon, authenticated;
revoke all on function public.sync_game_league_trophies() from public, anon, authenticated;

grant execute on function public.resolve_game_account_id(uuid) to service_role;
grant execute on function public.resolve_game_account_token(text) to service_role;
grant execute on function public.game_account_nick_keys(uuid) to service_role;
grant execute on function public.get_game_account_merge_impact(uuid,uuid) to service_role;
grant execute on function public.reconcile_game_player_identity_achievements(text) to service_role;
grant execute on function public.refresh_game_player_progression_achievements_unfiltered(text) to service_role;
grant execute on function public.refresh_game_player_progression_achievements(text) to service_role;
grant execute on function public.merge_game_accounts_internal(uuid,uuid,uuid,jsonb) to service_role;
grant execute on function public.prepare_game_auth_link(uuid,text,text,boolean,text,text) to service_role;
grant execute on function public.confirm_game_auth_merge(uuid,uuid,text) to service_role;
grant execute on function public.cancel_game_auth_merge(uuid,uuid) to service_role;
grant execute on function public.ensure_game_account_player(text,text,text,text,text,text) to service_role;
grant execute on function public.get_game_account_players(text) to service_role;
grant execute on function public.sync_game_league_trophies() to service_role;
