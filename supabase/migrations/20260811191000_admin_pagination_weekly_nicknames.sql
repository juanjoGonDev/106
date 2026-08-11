-- Finish weekly owner nickname changes and server-side zadmin pagination without
-- replacing the established admin/forced-rename owners from the prior migration.

alter table public.game_player_name_requirements
  add column if not exists original_nick text,
  add column if not exists original_nick_key text;

-- Recover the original moderated nickname for requirements that already exist.
with latest_require_change as (
  select distinct on (history.player_id)
    history.player_id,
    history.old_nick,
    history.old_nick_key
  from public.game_admin_nickname_actions history
  where history.action = 'require_change'
  order by history.player_id, history.created_at desc, history.id desc
)
update public.game_player_name_requirements requirement
set original_nick = coalesce(requirement.original_nick, history.old_nick),
    original_nick_key = coalesce(requirement.original_nick_key, history.old_nick_key)
from latest_require_change history
where history.player_id = requirement.player_id
  and requirement.required = true
  and (requirement.original_nick is null or requirement.original_nick_key is null);

-- Future forced resets automatically preserve the pre-reset name after the
-- canonical moderation owner writes its append-only require_change action.
create or replace function public.capture_required_rename_original_nick()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.action = 'require_change' then
    update public.game_player_name_requirements
    set original_nick = new.old_nick,
        original_nick_key = new.old_nick_key,
        updated_at = greatest(updated_at, new.created_at)
    where player_id = new.player_id
      and required = true;
  end if;
  return new;
end;
$$;

drop trigger if exists game_admin_nickname_actions_capture_original on public.game_admin_nickname_actions;
create trigger game_admin_nickname_actions_capture_original
after insert on public.game_admin_nickname_actions
for each row execute function public.capture_required_rename_original_nick();

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
    return jsonb_build_object('canRename', true, 'retryAfterSeconds', 0, 'nextRenameAt', null, 'lastChangedAt', null);
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
volatile
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
    where requirement.player_id = p_player_id
      and requirement.required = true
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
  if v_result->>'oldNickKey' = v_result->>'newNickKey' then
    return jsonb_build_object('error', 'nickname_unchanged');
  end if;

  insert into public.game_player_nickname_changes(
    player_id, source, old_nick, old_nick_key, new_nick, new_nick_key, created_at
  ) values (
    p_player_id, 'owner_voluntary', v_result->>'oldNick', v_result->>'oldNickKey',
    v_result->>'newNick', v_result->>'newNickKey', v_now
  );

  return v_result || jsonb_build_object('cooldown', public.game_player_rename_cooldown(p_player_id, v_now));
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
  where account_player.account_id = v_account_id
    and requirement.required = true
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
  select count(*)::integer into v_total
  from public.game_players player
  left join public.game_account_players account_player on account_player.player_id = player.player_id
  where v_search = ''
    or lower(player.nick) like '%' || v_search || '%'
    or lower(player.nick_key) like '%' || v_search || '%'
    or lower(player.player_id::text) like '%' || v_search || '%'
    or lower(coalesce(account_player.account_id::text, '')) like '%' || v_search || '%';

  v_total_pages := case when v_total = 0 then 0 else ceil(v_total::numeric / v_page_size)::integer end;
  if v_total_pages > 0 then v_page := least(v_page, v_total_pages); else v_page := 1; end if;

  select coalesce(jsonb_agg(item.payload order by item.created_at desc, item.player_id), '[]'::jsonb)
  into v_items
  from (
    select player.player_id, player.created_at,
      jsonb_build_object(
        'playerId', player.player_id,
        'nick', player.nick,
        'nickKey', player.nick_key,
        'accountId', account_player.account_id,
        'linkedAt', account_player.linked_at,
        'renameRequired', coalesce(requirement.required, false),
        'renameRequirement', case when requirement.required then jsonb_build_object(
          'reason', requirement.reason,
          'originalNick', requirement.original_nick,
          'requestedAt', requirement.requested_at
        ) else null end,
        'verifiedEmailAvailable', account.contact_email_verified_at is not null,
        'cooldown', public.game_player_rename_cooldown(player.player_id, p_at)
      ) as payload
    from public.game_players player
    left join public.game_account_players account_player on account_player.player_id = player.player_id
    left join public.game_player_name_requirements requirement on requirement.player_id = player.player_id
    left join public.game_accounts account on account.id = account_player.account_id
    where v_search = ''
      or lower(player.nick) like '%' || v_search || '%'
      or lower(player.nick_key) like '%' || v_search || '%'
      or lower(player.player_id::text) like '%' || v_search || '%'
      or lower(coalesce(account_player.account_id::text, '')) like '%' || v_search || '%'
    order by player.created_at desc, player.player_id
    offset (v_page - 1) * v_page_size
    limit v_page_size
  ) item;

  return jsonb_build_object(
    'items', v_items,
    'pagination', jsonb_build_object(
      'page', v_page,
      'pageSize', v_page_size,
      'total', v_total,
      'totalPages', v_total_pages,
      'hasPrevious', v_page > 1,
      'hasNext', v_total_pages > 0 and v_page < v_total_pages
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
  v_status text := case when p_status in ('active', 'lifted', 'revoked', 'expired') then p_status else 'all' end;
  v_scope text := case when p_scope in ('account', 'nick', 'device', 'ip') then p_scope else 'all' end;
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
      case when ban.expires_at <= p_at then 'expired' when latest.action = 'lift' then 'lifted' else 'active' end as status,
      case when latest.action is null then null else jsonb_build_object('action', latest.action, 'reason', latest.reason, 'created_at', latest.created_at) end as admin_action
    from public.game_integrity_bans ban left join latest_action latest on latest.ban_id = ban.id
    union all
    select ban.id::text, 'manual', ban.scope,
      case ban.scope when 'account' then ban.account_id::text when 'nick' then ban.nick_key else ban.ip_hash end,
      ban.reason, ban.created_at, ban.expires_at, null::integer, null::uuid, null::jsonb,
      case when ban.revoked_at is not null then 'revoked' when ban.expires_at is not null and ban.expires_at <= p_at then 'expired' else 'active' end,
      case when ban.revoked_at is null then null else jsonb_build_object('action', 'revoke', 'reason', ban.revoked_reason, 'created_at', ban.revoked_at) end
    from public.game_admin_bans ban
  ), filtered as (
    select * from combined row
    where (v_scope = 'all' or row.scope = v_scope)
      and (v_status = 'all' or row.status = v_status)
      and (v_search = ''
        or lower(coalesce(row.target, '')) like '%' || v_search || '%'
        or lower(coalesce(row.reason, '')) like '%' || v_search || '%'
        or lower(row.scope) like '%' || v_search || '%'
        or lower(row.source) like '%' || v_search || '%')
  )
  select count(*)::integer into v_total from filtered;

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
      case when ban.expires_at <= p_at then 'expired' when latest.action = 'lift' then 'lifted' else 'active' end as status,
      case when latest.action is null then null else jsonb_build_object('action', latest.action, 'reason', latest.reason, 'created_at', latest.created_at) end as admin_action
    from public.game_integrity_bans ban left join latest_action latest on latest.ban_id = ban.id
    union all
    select ban.id::text, 'manual', ban.scope,
      case ban.scope when 'account' then ban.account_id::text when 'nick' then ban.nick_key else ban.ip_hash end,
      ban.reason, ban.created_at, ban.expires_at, null::integer, null::uuid, null::jsonb,
      case when ban.revoked_at is not null then 'revoked' when ban.expires_at is not null and ban.expires_at <= p_at then 'expired' else 'active' end,
      case when ban.revoked_at is null then null else jsonb_build_object('action', 'revoke', 'reason', ban.revoked_reason, 'created_at', ban.revoked_at) end
    from public.game_admin_bans ban
  ), filtered as (
    select * from combined row
    where (v_scope = 'all' or row.scope = v_scope)
      and (v_status = 'all' or row.status = v_status)
      and (v_search = ''
        or lower(coalesce(row.target, '')) like '%' || v_search || '%'
        or lower(coalesce(row.reason, '')) like '%' || v_search || '%'
        or lower(row.scope) like '%' || v_search || '%'
        or lower(row.source) like '%' || v_search || '%')
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', row.id,
    'source', row.source,
    'scope', row.scope,
    'target', row.target,
    'reason', row.reason,
    'triggered_at', row.triggered_at,
    'expires_at', row.expires_at,
    'policy_version', row.policy_version,
    'source_attempt_id', row.source_attempt_id,
    'evidence', row.evidence,
    'status', row.status,
    'active', row.status = 'active',
    'adminAction', row.admin_action,
    'relatedNicks', '[]'::jsonb
  ) order by row.triggered_at desc, row.source, row.id), '[]'::jsonb)
  into v_items
  from (
    select * from filtered
    order by triggered_at desc, source, id
    offset (v_page - 1) * v_page_size
    limit v_page_size
  ) row;

  return jsonb_build_object(
    'items', v_items,
    'pagination', jsonb_build_object(
      'page', v_page,
      'pageSize', v_page_size,
      'total', v_total,
      'totalPages', v_total_pages,
      'hasPrevious', v_page > 1,
      'hasNext', v_total_pages > 0 and v_page < v_total_pages
    )
  );
end;
$$;

revoke all on function public.game_player_rename_cooldown(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.get_game_account_player_name_states(text, timestamptz) from public, anon, authenticated;
revoke all on function public.rename_game_player_by_owner(text, uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.zadmin_management_list_players(integer, integer, text, timestamptz) from public, anon, authenticated;
revoke all on function public.zadmin_management_list_restrictions(integer, integer, text, text, text, timestamptz) from public, anon, authenticated;

grant execute on function public.game_player_rename_cooldown(uuid, timestamptz) to service_role;
grant execute on function public.get_game_account_player_name_states(text, timestamptz) to service_role;
grant execute on function public.rename_game_player_by_owner(text, uuid, text, text, timestamptz) to service_role;
grant execute on function public.zadmin_management_list_players(integer, integer, text, timestamptz) to service_role;
grant execute on function public.zadmin_management_list_restrictions(integer, integer, text, text, text, timestamptz) to service_role;
