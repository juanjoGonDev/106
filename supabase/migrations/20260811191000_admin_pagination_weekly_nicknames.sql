-- Finish nickname lifecycle and server-side zadmin management pagination.

alter table public.game_player_name_requirements
  add column if not exists original_nick text,
  add column if not exists original_nick_key text;

-- Existing forced-rename rows can recover the pre-reset nickname from the
-- append-only moderation action created when the requirement was opened.
update public.game_player_name_requirements requirement
set original_nick = coalesce(requirement.original_nick, action.old_nick),
    original_nick_key = coalesce(requirement.original_nick_key, action.old_nick_key)
from lateral (
  select history.old_nick, history.old_nick_key
  from public.game_admin_nickname_actions history
  where history.player_id = requirement.player_id
    and history.action = 'require_change'
  order by history.created_at desc, history.id desc
  limit 1
) action
where requirement.required = true
  and (requirement.original_nick is null or requirement.original_nick_key is null);

create table if not exists public.game_player_nickname_changes (
  id bigint generated always as identity primary key,
  player_id uuid not null references public.game_players(player_id) on delete restrict,
  source text not null check (source in ('owner_voluntary', 'admin', 'forced_completion')),
  old_nick text not null,
  old_nick_key text not null,
  new_nick text not null,
  new_nick_key text not null,
  actor_session_id uuid references public.game_admin_sessions(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists game_player_nickname_changes_player_idx
  on public.game_player_nickname_changes(player_id, created_at desc, id desc);
create index if not exists game_player_nickname_changes_voluntary_idx
  on public.game_player_nickname_changes(player_id, created_at desc, id desc)
  where source = 'owner_voluntary';

alter table public.game_player_nickname_changes enable row level security;
revoke all on table public.game_player_nickname_changes from public, anon, authenticated;
grant select, insert, update, delete on table public.game_player_nickname_changes to service_role;
grant usage, select on sequence public.game_player_nickname_changes_id_seq to service_role;

drop trigger if exists game_player_nickname_changes_append_only on public.game_player_nickname_changes;
create trigger game_player_nickname_changes_append_only
before update or delete on public.game_player_nickname_changes
for each row execute function public.reject_admin_append_only_mutation();

create or replace function public.game_player_rename_cooldown(
  p_player_id uuid,
  p_at timestamptz default clock_timestamp()
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := coalesce(p_at, clock_timestamp());
  v_last timestamptz;
  v_next timestamptz;
begin
  if p_player_id is null then
    return jsonb_build_object('canRename', false, 'retryAfterSeconds', 0, 'nextRenameAt', null, 'lastChangedAt', null);
  end if;

  select change.created_at into v_last
  from public.game_player_nickname_changes change
  where change.player_id = p_player_id
    and change.source = 'owner_voluntary'
  order by change.created_at desc, change.id desc
  limit 1;

  if v_last is null then
    return jsonb_build_object(
      'canRename', true,
      'retryAfterSeconds', 0,
      'nextRenameAt', null,
      'lastChangedAt', null
    );
  end if;

  v_next := v_last + interval '7 days';
  return jsonb_build_object(
    'canRename', v_next <= v_now,
    'retryAfterSeconds', case when v_next <= v_now then 0 else greatest(1, ceil(extract(epoch from (v_next - v_now)))::integer) end,
    'nextRenameAt', v_next,
    'lastChangedAt', v_last
  );
end;
$$;

create or replace function public.get_game_account_player_name_states(
  p_account_token_hash text,
  p_at timestamptz default clock_timestamp()
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_account_id uuid;
  v_players jsonb;
begin
  if coalesce(p_account_token_hash, '') !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('error', 'account_token_required');
  end if;
  v_account_id := public.resolve_game_account_token(p_account_token_hash);
  if v_account_id is null then
    return jsonb_build_object('error', 'account_token_required');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'playerId', player.player_id,
    'nick', player.nick,
    'nickKey', player.nick_key,
    'renameRequired', coalesce(requirement.required, false),
    'originalNick', case when requirement.required then requirement.original_nick else null end,
    'temporaryNick', case when requirement.required then player.nick else null end,
    'requestedAt', case when requirement.required then requirement.requested_at else null end,
    'cooldown', public.game_player_rename_cooldown(player.player_id, p_at)
  ) order by account_player.linked_at, player.player_id), '[]'::jsonb)
  into v_players
  from public.game_account_players account_player
  join public.game_players player on player.player_id = account_player.player_id
  left join public.game_player_name_requirements requirement on requirement.player_id = player.player_id
  where account_player.account_id = v_account_id;

  return jsonb_build_object('players', v_players);
end;
$$;

create or replace function public.rename_game_player_by_owner(
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
  v_cooldown jsonb;
  v_result jsonb;
begin
  if coalesce(p_account_token_hash, '') !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('error', 'account_token_required');
  end if;
  v_account_id := public.resolve_game_account_token(p_account_token_hash);
  if v_account_id is null then return jsonb_build_object('error', 'account_token_required'); end if;

  if not exists (
    select 1 from public.game_account_players account_player
    where account_player.account_id = v_account_id
      and account_player.player_id = p_player_id
  ) then return jsonb_build_object('error', 'player_access_denied'); end if;

  perform pg_advisory_xact_lock(hashtextextended('owner-nickname-change:' || p_player_id::text, 0));

  if exists (
    select 1 from public.game_player_name_requirements requirement
    where requirement.player_id = p_player_id and requirement.required = true
  ) then return jsonb_build_object('error', 'nickname_change_required'); end if;

  v_cooldown := public.game_player_rename_cooldown(p_player_id, v_now);
  if coalesce((v_cooldown->>'canRename')::boolean, false) <> true then
    return jsonb_build_object(
      'error', 'nickname_cooldown',
      'nextRenameAt', v_cooldown->'nextRenameAt',
      'retryAfterSeconds', coalesce((v_cooldown->>'retryAfterSeconds')::integer, 1)
    );
  end if;

  v_result := public.rename_game_player_identity_internal(p_player_id, p_new_nick, p_new_nick_key);
  if v_result ? 'error' then return v_result; end if;

  insert into public.game_player_nickname_changes(
    player_id, source, old_nick, old_nick_key, new_nick, new_nick_key, actor_session_id, created_at
  ) values (
    p_player_id, 'owner_voluntary', v_result->>'oldNick', v_result->>'oldNickKey',
    v_result->>'newNick', v_result->>'newNickKey', null, v_now
  );

  return v_result || jsonb_build_object(
    'cooldown', public.game_player_rename_cooldown(p_player_id, v_now)
  );
end;
$$;

-- Admin renames use the same stable identity owner but never consume the
-- owner's voluntary weekly cooldown.
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
  set required = false, resolved_at = v_now, updated_at = v_now
  where player_id = p_player_id and required = true;

  insert into public.game_admin_nickname_actions(
    player_id, action, old_nick, old_nick_key, new_nick, new_nick_key, reason, actor_session_id, created_at
  ) values (
    p_player_id, 'rename', v_result->>'oldNick', v_result->>'oldNickKey',
    v_result->>'newNick', v_result->>'newNickKey', v_reason, p_actor_session_id, v_now
  );

  insert into public.game_player_nickname_changes(
    player_id, source, old_nick, old_nick_key, new_nick, new_nick_key, actor_session_id, created_at
  ) values (
    p_player_id, 'admin', v_result->>'oldNick', v_result->>'oldNickKey',
    v_result->>'newNick', v_result->>'newNickKey', p_actor_session_id, v_now
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
  v_before record;
  v_existing public.game_player_name_requirements%rowtype;
  v_result jsonb;
  v_original_nick text;
  v_original_key text;
begin
  if char_length(v_reason) not between 3 and 500 then return jsonb_build_object('error', 'invalid_reason'); end if;
  if not exists (
    select 1 from public.game_admin_sessions session
    where session.id = p_actor_session_id and session.revoked_at is null and session.expires_at > v_now
  ) then return jsonb_build_object('error', 'invalid_session'); end if;

  select player.nick, player.nick_key into v_before
  from public.game_players player where player.player_id = p_player_id;
  if not found then return jsonb_build_object('error', 'player_not_found'); end if;
  if not exists (select 1 from public.game_account_players account_player where account_player.player_id = p_player_id) then
    return jsonb_build_object('error', 'player_unlinked');
  end if;

  select * into v_existing from public.game_player_name_requirements where player_id = p_player_id;
  if found and v_existing.required = true then
    v_original_nick := coalesce(v_existing.original_nick, v_before.nick);
    v_original_key := coalesce(v_existing.original_nick_key, v_before.nick_key);
  else
    v_original_nick := v_before.nick;
    v_original_key := v_before.nick_key;
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
    player_id, required, reason, requested_by_session_id, requested_at, resolved_at, updated_at,
    original_nick, original_nick_key
  ) values (
    p_player_id, true, v_reason, p_actor_session_id, v_now, null, v_now,
    v_original_nick, v_original_key
  )
  on conflict (player_id) do update
  set required = true,
      reason = excluded.reason,
      requested_by_session_id = excluded.requested_by_session_id,
      requested_at = excluded.requested_at,
      resolved_at = null,
      updated_at = excluded.updated_at,
      original_nick = excluded.original_nick,
      original_nick_key = excluded.original_nick_key;

  insert into public.game_admin_nickname_actions(
    player_id, action, old_nick, old_nick_key, new_nick, new_nick_key, reason, actor_session_id, created_at
  ) values (
    p_player_id, 'require_change', v_result->>'oldNick', v_result->>'oldNickKey',
    v_result->>'newNick', v_result->>'newNickKey', v_reason, p_actor_session_id, v_now
  );

  insert into public.game_player_nickname_changes(
    player_id, source, old_nick, old_nick_key, new_nick, new_nick_key, actor_session_id, created_at
  ) values (
    p_player_id, 'admin', v_result->>'oldNick', v_result->>'oldNickKey',
    v_result->>'newNick', v_result->>'newNickKey', p_actor_session_id, v_now
  );

  insert into public.game_admin_audit_events(session_id, action, target_scope, target_key, metadata, created_at)
  values (
    p_actor_session_id, 'require_nick_change', 'player', p_player_id::text,
    jsonb_build_object('oldNick', v_original_nick, 'temporaryNick', v_result->>'newNick', 'reason', v_reason), v_now
  );

  return v_result || jsonb_build_object('required', true, 'reason', v_reason, 'originalNick', v_original_nick);
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

  select player.player_id, player.nick, requirement.original_nick, requirement.requested_at
  into v_row
  from public.game_account_players account_player
  join public.game_players player on player.player_id = account_player.player_id
  join public.game_player_name_requirements requirement on requirement.player_id = player.player_id
  where account_player.account_id = v_account_id and requirement.required = true
  order by requirement.requested_at, player.player_id
  limit 1;

  if not found then return null; end if;
  return jsonb_build_object(
    'required', true,
    'playerId', v_row.player_id,
    'originalNick', v_row.original_nick,
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
    where account_player.account_id = v_account_id and account_player.player_id = p_player_id
  ) then return jsonb_build_object('error', 'player_access_denied'); end if;

  select * into v_requirement from public.game_player_name_requirements where player_id = p_player_id for update;
  if not found or v_requirement.required <> true then return jsonb_build_object('error', 'nickname_change_not_required'); end if;

  v_result := public.rename_game_player_identity_internal(p_player_id, p_new_nick, p_new_nick_key);
  if v_result ? 'error' then return v_result; end if;

  update public.game_player_name_requirements
  set required = false, resolved_at = v_now, updated_at = v_now
  where player_id = p_player_id;

  insert into public.game_admin_nickname_actions(
    player_id, action, old_nick, old_nick_key, new_nick, new_nick_key, reason, actor_session_id, created_at
  ) values (
    p_player_id, 'resolve_change', v_result->>'oldNick', v_result->>'oldNickKey',
    v_result->>'newNick', v_result->>'newNickKey', 'Cambio requerido completado por el propietario.', null, v_now
  );

  insert into public.game_player_nickname_changes(
    player_id, source, old_nick, old_nick_key, new_nick, new_nick_key, actor_session_id, created_at
  ) values (
    p_player_id, 'forced_completion', v_result->>'oldNick', v_result->>'oldNickKey',
    v_result->>'newNick', v_result->>'newNickKey', null, v_now
  );

  return v_result || jsonb_build_object('required', false, 'originalNick', v_requirement.original_nick);
end;
$$;

create or replace function public.zadmin_management_list_players(
  p_page integer default 1,
  p_page_size integer default 25,
  p_search text default '',
  p_at timestamptz default clock_timestamp()
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_page integer := greatest(1, coalesce(p_page, 1));
  v_page_size integer := case when p_page_size in (10, 25, 50) then p_page_size else 25 end;
  v_search text := lower(trim(coalesce(p_search, '')));
  v_total integer;
  v_total_pages integer;
  v_items jsonb;
begin
  with filtered as (
    select player.player_id, player.nick, player.nick_key, player.created_at,
      account_player.account_id, account_player.linked_at,
      requirement.required as rename_required, requirement.reason as requirement_reason,
      requirement.original_nick, requirement.requested_at,
      (account.contact_email_verified_at is not null) as verified_email_available
    from public.game_players player
    left join public.game_account_players account_player on account_player.player_id = player.player_id
    left join public.game_player_name_requirements requirement on requirement.player_id = player.player_id
    left join public.game_accounts account on account.id = account_player.account_id
    where v_search = ''
      or lower(player.nick) like '%' || v_search || '%'
      or lower(player.nick_key) like '%' || v_search || '%'
      or lower(player.player_id::text) like '%' || v_search || '%'
      or lower(coalesce(account_player.account_id::text, '')) like '%' || v_search || '%'
  ) select count(*)::integer into v_total from filtered;

  v_total_pages := case when v_total = 0 then 0 else ceil(v_total::numeric / v_page_size)::integer end;
  if v_total_pages > 0 then v_page := least(v_page, v_total_pages); else v_page := 1; end if;

  with filtered as (
    select player.player_id, player.nick, player.nick_key, player.created_at,
      account_player.account_id, account_player.linked_at,
      requirement.required as rename_required, requirement.reason as requirement_reason,
      requirement.original_nick, requirement.requested_at,
      (account.contact_email_verified_at is not null) as verified_email_available
    from public.game_players player
    left join public.game_account_players account_player on account_player.player_id = player.player_id
    left join public.game_player_name_requirements requirement on requirement.player_id = player.player_id
    left join public.game_accounts account on account.id = account_player.account_id
    where v_search = ''
      or lower(player.nick) like '%' || v_search || '%'
      or lower(player.nick_key) like '%' || v_search || '%'
      or lower(player.player_id::text) like '%' || v_search || '%'
      or lower(coalesce(account_player.account_id::text, '')) like '%' || v_search || '%'
  ), page_rows as (
    select * from filtered
    order by created_at desc, player_id
    offset (v_page - 1) * v_page_size limit v_page_size
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'playerId', row.player_id,
    'nick', row.nick,
    'nickKey', row.nick_key,
    'accountId', row.account_id,
    'linkedAt', row.linked_at,
    'renameRequired', coalesce(row.rename_required, false),
    'renameRequirement', case when row.rename_required then jsonb_build_object(
      'reason', row.requirement_reason,
      'originalNick', row.original_nick,
      'requestedAt', row.requested_at
    ) else null end,
    'verifiedEmailAvailable', row.verified_email_available,
    'cooldown', public.game_player_rename_cooldown(row.player_id, p_at)
  ) order by row.created_at desc, row.player_id), '[]'::jsonb)
  into v_items from page_rows row;

  return jsonb_build_object(
    'items', v_items,
    'pagination', jsonb_build_object(
      'page', v_page, 'pageSize', v_page_size, 'total', v_total, 'totalPages', v_total_pages,
      'hasPrevious', v_page > 1, 'hasNext', v_total_pages > 0 and v_page < v_total_pages
    )
  );
end;
$$;

create or replace function public.zadmin_management_list_restrictions(
  p_page integer default 1,
  p_page_size integer default 25,
  p_status text default 'all',
  p_scope text default 'all',
  p_search text default '',
  p_at timestamptz default clock_timestamp()
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_page integer := greatest(1, coalesce(p_page, 1));
  v_page_size integer := case when p_page_size in (10, 25, 50) then p_page_size else 25 end;
  v_status text := case when p_status in ('active','lifted','revoked','expired') then p_status else 'all' end;
  v_scope text := case when p_scope in ('account','nick','device','ip') then p_scope else 'all' end;
  v_search text := lower(trim(coalesce(p_search, '')));
  v_total integer;
  v_total_pages integer;
  v_items jsonb;
begin
  with latest_action as (
    select distinct on (action.ban_id) action.ban_id, action.action, action.reason, action.created_at
    from public.game_integrity_ban_admin_actions action
    order by action.ban_id, action.created_at desc, action.id desc
  ), combined as (
    select ban.id::text as id, 'integrity'::text as source, ban.scope,
      case ban.scope when 'account' then ban.account_id::text when 'device' then ban.device_hash else ban.ip_hash end as target,
      ban.reason, ban.triggered_at, ban.expires_at, ban.policy_version, ban.source_attempt_id, ban.evidence,
      case when ban.expires_at <= p_at then 'expired'
           when latest.action = 'lift' then 'lifted' else 'active' end as status,
      case when latest.action is null then null else jsonb_build_object('action', latest.action, 'reason', latest.reason, 'created_at', latest.created_at) end as admin_action
    from public.game_integrity_bans ban
    left join latest_action latest on latest.ban_id = ban.id
    union all
    select ban.id::text, 'manual', ban.scope,
      case ban.scope when 'account' then ban.account_id::text when 'nick' then ban.nick_key else ban.ip_hash end,
      ban.reason, ban.created_at, ban.expires_at, null::integer, null::uuid, null::jsonb,
      case when ban.revoked_at is not null then 'revoked'
           when ban.expires_at is not null and ban.expires_at <= p_at then 'expired' else 'active' end,
      case when ban.revoked_at is null then null else jsonb_build_object('action','revoke','reason',ban.revoked_reason,'created_at',ban.revoked_at) end
    from public.game_admin_bans ban
  ), filtered as (
    select * from combined row
    where (v_scope = 'all' or row.scope = v_scope)
      and (v_status = 'all' or row.status = v_status)
      and (v_search = '' or lower(coalesce(row.target,'')) like '%' || v_search || '%'
        or lower(coalesce(row.reason,'')) like '%' || v_search || '%'
        or lower(row.scope) like '%' || v_search || '%'
        or lower(row.source) like '%' || v_search || '%')
  ) select count(*)::integer into v_total from filtered;

  v_total_pages := case when v_total = 0 then 0 else ceil(v_total::numeric / v_page_size)::integer end;
  if v_total_pages > 0 then v_page := least(v_page, v_total_pages); else v_page := 1; end if;

  with latest_action as (
    select distinct on (action.ban_id) action.ban_id, action.action, action.reason, action.created_at
    from public.game_integrity_ban_admin_actions action
    order by action.ban_id, action.created_at desc, action.id desc
  ), combined as (
    select ban.id::text as id, 'integrity'::text as source, ban.scope,
      case ban.scope when 'account' then ban.account_id::text when 'device' then ban.device_hash else ban.ip_hash end as target,
      ban.reason, ban.triggered_at, ban.expires_at, ban.policy_version, ban.source_attempt_id, ban.evidence,
      case when ban.expires_at <= p_at then 'expired'
           when latest.action = 'lift' then 'lifted' else 'active' end as status,
      case when latest.action is null then null else jsonb_build_object('action', latest.action, 'reason', latest.reason, 'created_at', latest.created_at) end as admin_action
    from public.game_integrity_bans ban
    left join latest_action latest on latest.ban_id = ban.id
    union all
    select ban.id::text, 'manual', ban.scope,
      case ban.scope when 'account' then ban.account_id::text when 'nick' then ban.nick_key else ban.ip_hash end,
      ban.reason, ban.created_at, ban.expires_at, null::integer, null::uuid, null::jsonb,
      case when ban.revoked_at is not null then 'revoked'
           when ban.expires_at is not null and ban.expires_at <= p_at then 'expired' else 'active' end,
      case when ban.revoked_at is null then null else jsonb_build_object('action','revoke','reason',ban.revoked_reason,'created_at',ban.revoked_at) end
    from public.game_admin_bans ban
  ), filtered as (
    select * from combined row
    where (v_scope = 'all' or row.scope = v_scope)
      and (v_status = 'all' or row.status = v_status)
      and (v_search = '' or lower(coalesce(row.target,'')) like '%' || v_search || '%'
        or lower(coalesce(row.reason,'')) like '%' || v_search || '%'
        or lower(row.scope) like '%' || v_search || '%'
        or lower(row.source) like '%' || v_search || '%')
  ), page_rows as (
    select * from filtered order by triggered_at desc, source, id
    offset (v_page - 1) * v_page_size limit v_page_size
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', row.id, 'source', row.source, 'scope', row.scope, 'target', row.target,
    'reason', row.reason, 'triggered_at', row.triggered_at, 'expires_at', row.expires_at,
    'policy_version', row.policy_version, 'source_attempt_id', row.source_attempt_id,
    'evidence', row.evidence, 'status', row.status, 'active', row.status = 'active',
    'adminAction', row.admin_action, 'relatedNicks', '[]'::jsonb
  ) order by row.triggered_at desc, row.source, row.id), '[]'::jsonb)
  into v_items from page_rows row;

  return jsonb_build_object(
    'items', v_items,
    'pagination', jsonb_build_object(
      'page', v_page, 'pageSize', v_page_size, 'total', v_total, 'totalPages', v_total_pages,
      'hasPrevious', v_page > 1, 'hasNext', v_total_pages > 0 and v_page < v_total_pages
    )
  );
end;
$$;

revoke all on function public.game_player_rename_cooldown(uuid,timestamptz) from public, anon, authenticated;
revoke all on function public.get_game_account_player_name_states(text,timestamptz) from public, anon, authenticated;
revoke all on function public.rename_game_player_by_owner(text,uuid,text,text,timestamptz) from public, anon, authenticated;
revoke all on function public.zadmin_management_list_players(integer,integer,text,timestamptz) from public, anon, authenticated;
revoke all on function public.zadmin_management_list_restrictions(integer,integer,text,text,text,timestamptz) from public, anon, authenticated;

grant execute on function public.game_player_rename_cooldown(uuid,timestamptz) to service_role;
grant execute on function public.get_game_account_player_name_states(text,timestamptz) to service_role;
grant execute on function public.rename_game_player_by_owner(text,uuid,text,text,timestamptz) to service_role;
grant execute on function public.zadmin_management_list_players(integer,integer,text,timestamptz) to service_role;
grant execute on function public.zadmin_management_list_restrictions(integer,integer,text,text,text,timestamptz) to service_role;
