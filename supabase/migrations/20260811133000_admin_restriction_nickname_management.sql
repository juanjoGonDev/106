-- Stable player identity, automatic-restriction overrides and moderated nickname lifecycle.

alter table public.game_players
  add column if not exists player_id uuid;

update public.game_players
set player_id = gen_random_uuid()
where player_id is null;

alter table public.game_players
  alter column player_id set default gen_random_uuid(),
  alter column player_id set not null;

create unique index if not exists game_players_player_id_key
  on public.game_players(player_id);

alter table public.game_account_players
  add column if not exists player_id uuid;

update public.game_account_players account_player
set player_id = player.player_id
from public.game_players player
where player.nick_key = account_player.nick_key
  and account_player.player_id is distinct from player.player_id;

alter table public.game_account_players
  alter column player_id set not null;

create unique index if not exists game_account_players_player_id_key
  on public.game_account_players(player_id);

-- Existing nickname-key FKs remain a compatibility projection during the
-- progressive migration to player_id. Their explicit names make this boundary
-- auditable and allow one transaction to update the parent + all children.
alter table public.game_player_bonus
  alter constraint game_player_bonus_nick_key_fkey deferrable initially immediate;
alter table public.game_referrals
  alter constraint game_referrals_referrer_nick_key_fkey deferrable initially immediate;
alter table public.game_referrals
  alter constraint game_referrals_referred_nick_key_fkey deferrable initially immediate;
alter table public.game_duels
  alter constraint game_duels_challenger_nick_key_fkey deferrable initially immediate;
alter table public.game_duels
  alter constraint game_duels_opponent_nick_key_fkey deferrable initially immediate;
alter table public.game_leagues
  alter constraint game_leagues_owner_nick_key_fkey deferrable initially immediate;
alter table public.game_league_members
  alter constraint game_league_members_nick_key_fkey deferrable initially immediate;
alter table public.game_daily_trophies
  alter constraint game_daily_trophies_nick_key_fkey deferrable initially immediate;
alter table public.game_player_achievements
  alter constraint game_player_achievements_nick_key_fkey deferrable initially immediate;
alter table public.game_league_trophies
  alter constraint game_league_trophies_nick_key_fkey deferrable initially immediate;
alter table public.game_player_featured_achievements
  alter constraint game_player_featured_achievements_nick_key_fkey deferrable initially immediate;
alter table public.game_account_players
  alter constraint game_account_players_nick_key_fkey deferrable initially immediate;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'game_account_players_player_id_fkey'
      and conrelid = 'public.game_account_players'::regclass
  ) then
    alter table public.game_account_players
      add constraint game_account_players_player_id_fkey
      foreign key (player_id) references public.game_players(player_id)
      on delete cascade;
  end if;
end;
$$;

create table if not exists public.game_integrity_ban_admin_actions (
  id bigint generated always as identity primary key,
  ban_id bigint not null references public.game_integrity_bans(id) on delete restrict,
  action text not null check (action in ('lift', 'reinstate')),
  reason text not null check (char_length(reason) between 3 and 500),
  actor_session_id uuid not null references public.game_admin_sessions(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists game_integrity_ban_admin_actions_latest_idx
  on public.game_integrity_ban_admin_actions(ban_id, created_at desc, id desc);

create table if not exists public.game_player_name_requirements (
  player_id uuid primary key references public.game_players(player_id) on delete cascade,
  required boolean not null default true,
  reason text not null check (char_length(reason) between 3 and 500),
  requested_by_session_id uuid references public.game_admin_sessions(id) on delete restrict,
  requested_at timestamptz not null default clock_timestamp(),
  resolved_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  constraint game_player_name_requirements_state_check check (
    (required = true and resolved_at is null)
    or (required = false and resolved_at is not null)
  )
);

create index if not exists game_player_name_requirements_active_idx
  on public.game_player_name_requirements(required, requested_at desc)
  where required = true;

create table if not exists public.game_admin_nickname_actions (
  id bigint generated always as identity primary key,
  player_id uuid not null references public.game_players(player_id) on delete restrict,
  action text not null check (action in ('rename', 'require_change', 'resolve_change')),
  old_nick text not null,
  old_nick_key text not null,
  new_nick text not null,
  new_nick_key text not null,
  reason text not null check (char_length(reason) between 3 and 500),
  actor_session_id uuid references public.game_admin_sessions(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists game_admin_nickname_actions_player_idx
  on public.game_admin_nickname_actions(player_id, created_at desc, id desc);

alter table public.game_integrity_ban_admin_actions enable row level security;
alter table public.game_player_name_requirements enable row level security;
alter table public.game_admin_nickname_actions enable row level security;

revoke all on table
  public.game_integrity_ban_admin_actions,
  public.game_player_name_requirements,
  public.game_admin_nickname_actions
from public, anon, authenticated;

grant select, insert on table
  public.game_integrity_ban_admin_actions,
  public.game_admin_nickname_actions
  to service_role;

grant select, insert, update on table public.game_player_name_requirements to service_role;
grant usage, select on sequence public.game_integrity_ban_admin_actions_id_seq to service_role;
grant usage, select on sequence public.game_admin_nickname_actions_id_seq to service_role;

create or replace function public.reject_admin_append_only_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'append-only admin history cannot be modified';
end;
$$;

drop trigger if exists game_integrity_ban_admin_actions_append_only on public.game_integrity_ban_admin_actions;
create trigger game_integrity_ban_admin_actions_append_only
before update or delete on public.game_integrity_ban_admin_actions
for each row execute function public.reject_admin_append_only_mutation();

drop trigger if exists game_admin_nickname_actions_append_only on public.game_admin_nickname_actions;
create trigger game_admin_nickname_actions_append_only
before update or delete on public.game_admin_nickname_actions
for each row execute function public.reject_admin_append_only_mutation();

create or replace function public.game_integrity_ban_admin_state(p_ban_id bigint)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select action.action
    from public.game_integrity_ban_admin_actions action
    where action.ban_id = p_ban_id
    order by action.created_at desc, action.id desc
    limit 1
  ), 'none');
$$;

-- Original policy-v3 rows remain immutable. A latest lift action suppresses the
-- matching ban in the canonical gameplay enforcement lookup.
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
    and public.game_integrity_ban_admin_state(ban.id) <> 'lift'
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

  if not found then return jsonb_build_object('banned', false); end if;
  return jsonb_build_object(
    'banned', true,
    'scope', v_ban.scope,
    'expiresAt', v_ban.expires_at,
    'retryAfterSeconds', greatest(1, ceil(extract(epoch from (v_ban.expires_at - v_now)))::integer),
    'policyVersion', v_ban.policy_version
  );
end;
$$;

create or replace function public.zadmin_set_integrity_ban_action(
  p_ban_id bigint,
  p_action text,
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
  v_action text := lower(trim(coalesce(p_action, '')));
  v_reason text := trim(coalesce(p_reason, ''));
  v_ban public.game_integrity_bans%rowtype;
  v_current text;
begin
  if v_action not in ('lift', 'reinstate') then return jsonb_build_object('error', 'invalid_action'); end if;
  if char_length(v_reason) not between 3 and 500 then return jsonb_build_object('error', 'invalid_reason'); end if;
  if not exists (
    select 1 from public.game_admin_sessions session
    where session.id = p_actor_session_id
      and session.revoked_at is null
      and session.expires_at > v_now
  ) then return jsonb_build_object('error', 'invalid_session'); end if;

  select * into v_ban from public.game_integrity_bans where id = p_ban_id for share;
  if not found then return jsonb_build_object('error', 'ban_not_found'); end if;
  if v_ban.expires_at <= v_now then return jsonb_build_object('error', 'ban_expired'); end if;

  perform pg_advisory_xact_lock(hashtextextended('zadmin-integrity-ban:' || p_ban_id::text, 0));
  v_current := public.game_integrity_ban_admin_state(p_ban_id);
  if v_action = 'lift' and v_current = 'lift' then return jsonb_build_object('error', 'already_lifted'); end if;
  if v_action = 'reinstate' and v_current <> 'lift' then return jsonb_build_object('error', 'not_lifted'); end if;

  insert into public.game_integrity_ban_admin_actions(ban_id, action, reason, actor_session_id, created_at)
  values (p_ban_id, v_action, v_reason, p_actor_session_id, v_now);

  insert into public.game_admin_audit_events(session_id, action, target_scope, target_key, metadata, created_at)
  values (
    p_actor_session_id,
    case when v_action = 'lift' then 'lift_integrity' else 'reinstate_integrity' end,
    'integrity',
    p_ban_id::text,
    jsonb_build_object('reason', v_reason, 'scope', v_ban.scope, 'expiresAt', v_ban.expires_at),
    v_now
  );

  return jsonb_build_object(
    'updated', true,
    'banId', p_ban_id,
    'adminState', v_action,
    'active', v_action <> 'lift' and v_ban.expires_at > v_now
  );
end;
$$;

create or replace function public.rename_game_player_identity_internal(
  p_player_id uuid,
  p_new_nick text,
  p_new_nick_key text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_player public.game_players%rowtype;
  v_new_nick text := trim(coalesce(p_new_nick, ''));
  v_new_key text := lower(trim(coalesce(p_new_nick_key, '')));
begin
  if p_player_id is null
     or char_length(v_new_nick) not between 2 and 24
     or char_length(v_new_key) not between 2 and 24 then
    return jsonb_build_object('error', 'invalid_nickname');
  end if;

  select * into v_player
  from public.game_players
  where player_id = p_player_id
  for update;
  if not found then return jsonb_build_object('error', 'player_not_found'); end if;

  perform pg_advisory_xact_lock(hashtextextended('player-id:' || p_player_id::text, 0));
  perform pg_advisory_xact_lock(least(
    hashtextextended('nick:' || v_player.nick_key, 0),
    hashtextextended('nick:' || v_new_key, 0)
  ));
  if v_player.nick_key <> v_new_key then
    perform pg_advisory_xact_lock(greatest(
      hashtextextended('nick:' || v_player.nick_key, 0),
      hashtextextended('nick:' || v_new_key, 0)
    ));
  end if;

  if exists (
    select 1 from public.game_players other
    where other.nick_key = v_new_key
      and other.player_id <> p_player_id
  ) then return jsonb_build_object('error', 'nickname_taken'); end if;

  if v_player.nick_key = v_new_key then
    update public.game_players set nick = v_new_nick where player_id = p_player_id;
    update public.game_attempts set nick = v_new_nick where nick_key = v_player.nick_key;
    update public.game_challenges set nick = v_new_nick where nick_key = v_player.nick_key;
    return jsonb_build_object(
      'renamed', true,
      'playerId', p_player_id,
      'oldNick', v_player.nick,
      'oldNickKey', v_player.nick_key,
      'newNick', v_new_nick,
      'newNickKey', v_new_key
    );
  end if;

  set constraints all deferred;

  update public.game_players
  set nick = v_new_nick,
      nick_key = v_new_key
  where player_id = p_player_id;

  update public.game_player_bonus
  set nick_key = v_new_key
  where nick_key = v_player.nick_key;

  update public.game_referrals
  set referrer_nick_key = v_new_key
  where referrer_nick_key = v_player.nick_key;

  update public.game_referrals
  set referred_nick_key = v_new_key
  where referred_nick_key = v_player.nick_key;

  update public.game_duels
  set challenger_nick_key = v_new_key
  where challenger_nick_key = v_player.nick_key;

  update public.game_duels
  set opponent_nick_key = v_new_key
  where opponent_nick_key = v_player.nick_key;

  update public.game_leagues
  set owner_nick_key = v_new_key
  where owner_nick_key = v_player.nick_key;

  update public.game_league_members
  set nick_key = v_new_key
  where nick_key = v_player.nick_key;

  update public.game_daily_trophies
  set nick_key = v_new_key
  where nick_key = v_player.nick_key;

  update public.game_player_achievements
  set nick_key = v_new_key
  where nick_key = v_player.nick_key;

  update public.game_league_trophies
  set nick_key = v_new_key
  where nick_key = v_player.nick_key;

  update public.game_player_featured_achievements
  set nick_key = v_new_key
  where nick_key = v_player.nick_key;

  update public.game_account_players
  set nick_key = v_new_key
  where player_id = p_player_id;

  -- Legacy attempt/challenge rows predate the game_players FK and intentionally
  -- keep immutable timing/security evidence while their display identity follows
  -- the current player nickname.
  update public.game_attempts
  set nick_key = v_new_key,
      nick = v_new_nick
  where nick_key = v_player.nick_key;

  update public.game_challenges
  set nick_key = v_new_key,
      nick = v_new_nick
  where nick_key = v_player.nick_key;

  -- A manual nick ban follows the same stable player during a rename. Historical
  -- audit event target strings are intentionally retained as historical evidence.
  update public.game_admin_bans
  set nick_key = v_new_key
  where scope = 'nick'
    and nick_key = v_player.nick_key;

  return jsonb_build_object(
    'renamed', true,
    'playerId', p_player_id,
    'oldNick', v_player.nick,
    'oldNickKey', v_player.nick_key,
    'newNick', v_new_nick,
    'newNickKey', v_new_key
  );
end;
$$;

create or replace function public.zadmin_rename_player(
  p_player_id uuid,
  p_new_nick text,
  p_new_nick_key text,
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
  v_result jsonb;
begin
  if char_length(v_reason) not between 3 and 500 then return jsonb_build_object('error', 'invalid_reason'); end if;
  if not exists (
    select 1 from public.game_admin_sessions session
    where session.id = p_actor_session_id
      and session.revoked_at is null
      and session.expires_at > v_now
  ) then return jsonb_build_object('error', 'invalid_session'); end if;

  v_result := public.rename_game_player_identity_internal(p_player_id, p_new_nick, p_new_nick_key);
  if v_result ? 'error' then return v_result; end if;

  update public.game_player_name_requirements
  set required = false,
      resolved_at = v_now,
      updated_at = v_now
  where player_id = p_player_id
    and required = true;

  insert into public.game_admin_nickname_actions(
    player_id, action, old_nick, old_nick_key, new_nick, new_nick_key, reason, actor_session_id, created_at
  ) values (
    p_player_id, 'rename', v_result->>'oldNick', v_result->>'oldNickKey',
    v_result->>'newNick', v_result->>'newNickKey', v_reason, p_actor_session_id, v_now
  );

  insert into public.game_admin_audit_events(session_id, action, target_scope, target_key, metadata, created_at)
  values (
    p_actor_session_id, 'rename_nick', 'player', p_player_id::text,
    jsonb_build_object('oldNick', v_result->>'oldNick', 'newNick', v_result->>'newNick', 'reason', v_reason), v_now
  );

  return v_result || jsonb_build_object('required', false);
end;
$$;

create or replace function public.zadmin_require_player_rename(
  p_player_id uuid,
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
  v_key text;
  v_nick text;
  v_result jsonb;
begin
  if char_length(v_reason) not between 3 and 500 then return jsonb_build_object('error', 'invalid_reason'); end if;
  if not exists (
    select 1 from public.game_admin_sessions session
    where session.id = p_actor_session_id
      and session.revoked_at is null
      and session.expires_at > v_now
  ) then return jsonb_build_object('error', 'invalid_session'); end if;
  if not exists (select 1 from public.game_players where player_id = p_player_id) then
    return jsonb_build_object('error', 'player_not_found');
  end if;

  v_nick := 'Jugador-' || substring(replace(p_player_id::text, '-', '') from 1 for 12);
  v_key := lower(v_nick);
  if exists (select 1 from public.game_players where nick_key = v_key and player_id <> p_player_id) then
    v_nick := 'Jugador-' || substring(replace(p_player_id::text, '-', '') from 1 for 16);
    v_key := lower(v_nick);
  end if;

  v_result := public.rename_game_player_identity_internal(p_player_id, v_nick, v_key);
  if v_result ? 'error' then return v_result; end if;

  insert into public.game_player_name_requirements(
    player_id, required, reason, requested_by_session_id, requested_at, resolved_at, updated_at
  ) values (
    p_player_id, true, v_reason, p_actor_session_id, v_now, null, v_now
  )
  on conflict (player_id) do update
  set required = true,
      reason = excluded.reason,
      requested_by_session_id = excluded.requested_by_session_id,
      requested_at = excluded.requested_at,
      resolved_at = null,
      updated_at = excluded.updated_at;

  insert into public.game_admin_nickname_actions(
    player_id, action, old_nick, old_nick_key, new_nick, new_nick_key, reason, actor_session_id, created_at
  ) values (
    p_player_id, 'require_change', v_result->>'oldNick', v_result->>'oldNickKey',
    v_result->>'newNick', v_result->>'newNickKey', v_reason, p_actor_session_id, v_now
  );

  insert into public.game_admin_audit_events(session_id, action, target_scope, target_key, metadata, created_at)
  values (
    p_actor_session_id, 'require_nick_change', 'player', p_player_id::text,
    jsonb_build_object('oldNick', v_result->>'oldNick', 'temporaryNick', v_result->>'newNick', 'reason', v_reason), v_now
  );

  return v_result || jsonb_build_object('required', true, 'reason', v_reason);
end;
$$;

create or replace function public.get_game_account_nickname_requirement(p_account_token_hash text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_account_id uuid;
  v_row record;
begin
  if coalesce(p_account_token_hash, '') !~ '^[a-f0-9]{64}$' then return null; end if;
  v_account_id := public.resolve_game_account_token(p_account_token_hash);
  if v_account_id is null then return null; end if;

  select
    player.player_id,
    player.nick,
    requirement.requested_at
  into v_row
  from public.game_account_players account_player
  join public.game_players player on player.player_id = account_player.player_id
  join public.game_player_name_requirements requirement on requirement.player_id = player.player_id
  where account_player.account_id = v_account_id
    and requirement.required = true
  order by requirement.requested_at, player.player_id
  limit 1;

  if not found then return null; end if;
  return jsonb_build_object(
    'required', true,
    'playerId', v_row.player_id,
    'temporaryNick', v_row.nick,
    'requestedAt', v_row.requested_at,
    'reason', 'Tu nombre de jugador debe cambiarse antes de continuar.'
  );
end;
$$;

create or replace function public.complete_game_player_required_rename(
  p_account_token_hash text,
  p_player_id uuid,
  p_new_nick text,
  p_new_nick_key text,
  p_at timestamptz default clock_timestamp()
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := coalesce(p_at, clock_timestamp());
  v_account_id uuid;
  v_requirement public.game_player_name_requirements%rowtype;
  v_result jsonb;
begin
  if coalesce(p_account_token_hash, '') !~ '^[a-f0-9]{64}$' then return jsonb_build_object('error', 'account_token_required'); end if;
  v_account_id := public.resolve_game_account_token(p_account_token_hash);
  if v_account_id is null then return jsonb_build_object('error', 'account_token_required'); end if;

  if not exists (
    select 1 from public.game_account_players account_player
    where account_player.account_id = v_account_id
      and account_player.player_id = p_player_id
  ) then return jsonb_build_object('error', 'player_access_denied'); end if;

  select * into v_requirement
  from public.game_player_name_requirements
  where player_id = p_player_id
  for update;
  if not found or v_requirement.required <> true then return jsonb_build_object('error', 'nickname_change_not_required'); end if;

  v_result := public.rename_game_player_identity_internal(p_player_id, p_new_nick, p_new_nick_key);
  if v_result ? 'error' then return v_result; end if;

  update public.game_player_name_requirements
  set required = false,
      resolved_at = v_now,
      updated_at = v_now
  where player_id = p_player_id;

  insert into public.game_admin_nickname_actions(
    player_id, action, old_nick, old_nick_key, new_nick, new_nick_key, reason, actor_session_id, created_at
  ) values (
    p_player_id, 'resolve_change', v_result->>'oldNick', v_result->>'oldNickKey',
    v_result->>'newNick', v_result->>'newNickKey', 'Cambio requerido completado por el propietario.', null, v_now
  );

  return v_result || jsonb_build_object('required', false);
end;
$$;

-- Expand the existing audit CHECK constraints using the safe drop/re-add pattern
-- accepted by the repository migration guard.
alter table public.game_admin_audit_events drop constraint if exists game_admin_audit_events_action_check;
alter table public.game_admin_audit_events
  add constraint game_admin_audit_events_action_check check (
    action in (
      'ban', 'revoke', 'invalidate_attempt', 'restore_attempt',
      'lift_integrity', 'reinstate_integrity', 'rename_nick', 'require_nick_change'
    )
  );

alter table public.game_admin_audit_events drop constraint if exists game_admin_audit_events_target_scope_check;
alter table public.game_admin_audit_events
  add constraint game_admin_audit_events_target_scope_check check (
    target_scope in ('account', 'nick', 'ip', 'attempt', 'integrity', 'player')
  );

-- Existing rows linked after this migration must carry player_id too.
create or replace function public.sync_game_account_player_id()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.player_id is null then
    select player.player_id into new.player_id
    from public.game_players player
    where player.nick_key = new.nick_key;
  end if;
  return new;
end;
$$;

drop trigger if exists game_account_players_sync_player_id on public.game_account_players;
create trigger game_account_players_sync_player_id
before insert or update of nick_key on public.game_account_players
for each row execute function public.sync_game_account_player_id();

revoke all on function public.game_integrity_ban_admin_state(bigint) from public, anon, authenticated;
revoke all on function public.zadmin_set_integrity_ban_action(bigint,text,text,uuid,timestamptz) from public, anon, authenticated;
revoke all on function public.rename_game_player_identity_internal(uuid,text,text) from public, anon, authenticated;
revoke all on function public.zadmin_rename_player(uuid,text,text,text,uuid,timestamptz) from public, anon, authenticated;
revoke all on function public.zadmin_require_player_rename(uuid,text,uuid,timestamptz) from public, anon, authenticated;
revoke all on function public.get_game_account_nickname_requirement(text) from public, anon, authenticated;
revoke all on function public.complete_game_player_required_rename(text,uuid,text,text,timestamptz) from public, anon, authenticated;
revoke all on function public.sync_game_account_player_id() from public, anon, authenticated;

grant execute on function public.game_integrity_ban_admin_state(bigint) to service_role;
grant execute on function public.zadmin_set_integrity_ban_action(bigint,text,text,uuid,timestamptz) to service_role;
grant execute on function public.rename_game_player_identity_internal(uuid,text,text) to service_role;
grant execute on function public.zadmin_rename_player(uuid,text,text,text,uuid,timestamptz) to service_role;
grant execute on function public.zadmin_require_player_rename(uuid,text,uuid,timestamptz) to service_role;
grant execute on function public.get_game_account_nickname_requirement(text) to service_role;
grant execute on function public.complete_game_player_required_rename(text,uuid,text,text,timestamptz) to service_role;
