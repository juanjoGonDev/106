alter table public.game_auth_identities
  add column if not exists origin_provider text;

update public.game_auth_identities
set origin_provider = provider
where origin_provider is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'game_auth_identities_origin_provider_check'
      and conrelid = 'public.game_auth_identities'::regclass
  ) then
    alter table public.game_auth_identities
      add constraint game_auth_identities_origin_provider_check
      check (origin_provider in ('email', 'google', 'facebook'));
  end if;
end;
$$;

update public.game_account_entitlements entitlement
set entitlement_code = 'auth_identity_daily_attempt',
    metadata = entitlement.metadata || jsonb_build_object(
      'source', coalesce(entitlement.metadata->>'source', 'email_confirmation'),
      'dailyAttemptBonus', 1
    )
where entitlement.entitlement_code = 'verified_email_daily_attempt'
  and not exists (
    select 1
    from public.game_account_entitlements existing
    where existing.account_id = entitlement.account_id
      and existing.entitlement_code = 'auth_identity_daily_attempt'
  );

delete from public.game_account_entitlements legacy
where legacy.entitlement_code = 'verified_email_daily_attempt'
  and exists (
    select 1
    from public.game_account_entitlements current
    where current.account_id = legacy.account_id
      and current.entitlement_code = 'auth_identity_daily_attempt'
  );

create or replace function public.record_game_auth_origin(
  p_auth_user_id uuid,
  p_provider text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity public.game_auth_identities%rowtype;
begin
  if p_auth_user_id is null or p_provider not in ('email', 'google', 'facebook') then
    return jsonb_build_object('error', 'invalid_input');
  end if;

  update public.game_auth_identities identity
  set origin_provider = coalesce(identity.origin_provider, p_provider),
      last_authenticated_at = clock_timestamp()
  where identity.auth_user_id = p_auth_user_id
  returning identity.* into v_identity;

  if not found then
    return jsonb_build_object('error', 'account_not_found');
  end if;

  return jsonb_build_object(
    'originProvider', coalesce(v_identity.origin_provider, v_identity.provider),
    'provider', v_identity.provider,
    'accountId', public.resolve_game_account_id(v_identity.account_id)
  );
end;
$$;

create or replace function public.game_account_auth_daily_bonus(p_account_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_account_id uuid := public.resolve_game_account_id(p_account_id);
begin
  if v_account_id is null then return 0; end if;

  return case when exists (
    select 1
    from public.game_account_entitlements entitlement
    where entitlement.entitlement_code in (
        'auth_identity_daily_attempt',
        'verified_email_daily_attempt'
      )
      and public.resolve_game_account_id(entitlement.account_id) = v_account_id
  ) then 1 else 0 end;
end;
$$;

create or replace function public.sync_game_verified_email_achievement(p_account_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_account_id uuid := public.resolve_game_account_id(p_account_id);
  v_inserted integer := 0;
begin
  if v_account_id is null then return 0; end if;

  if not exists (
    select 1
    from public.game_account_entitlements entitlement
    where entitlement.entitlement_code in (
        'auth_identity_daily_attempt',
        'verified_email_daily_attempt'
      )
      and public.resolve_game_account_id(entitlement.account_id) = v_account_id
      and (
        entitlement.entitlement_code = 'verified_email_daily_attempt'
        or entitlement.metadata->>'source' = 'email_confirmation'
      )
  ) then
    return 0;
  end if;

  insert into public.game_player_achievements(
    nick_key,
    achievement_code,
    achievement_kind,
    title,
    description,
    points,
    achieved_on,
    metadata
  )
  select account_player.nick_key,
    'email_verified',
    'email_verified',
    'Cuenta confirmada',
    'Confirmaste tu email y protegiste el acceso a tu progreso.',
    10,
    (clock_timestamp() at time zone 'Europe/Madrid')::date,
    jsonb_build_object('dailyAttemptBonus', 1, 'accountReward', true)
  from public.game_account_players account_player
  where public.resolve_game_account_id(account_player.account_id) = v_account_id
  on conflict (nick_key, achievement_code) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

create or replace function public.grant_game_auth_link_reward(p_auth_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity public.game_auth_identities%rowtype;
  v_origin public.game_auth_identities%rowtype;
  v_entitlement public.game_account_entitlements%rowtype;
  v_account_id uuid;
  v_origin_provider text;
  v_source text;
  v_inserted integer := 0;
  v_achievements integer := 0;
begin
  select identity.* into v_identity
  from public.game_auth_identities identity
  where identity.auth_user_id = p_auth_user_id
  for update;

  if not found then
    return jsonb_build_object(
      'eligible', false,
      'active', false,
      'granted', false,
      'dailyAttemptBonus', 0
    );
  end if;

  v_account_id := public.resolve_game_account_id(v_identity.account_id);
  if v_account_id is null then
    return jsonb_build_object(
      'eligible', false,
      'active', false,
      'granted', false,
      'dailyAttemptBonus', 0
    );
  end if;

  perform pg_advisory_xact_lock(hashtextextended('auth-reward:' || v_account_id::text, 106));

  select entitlement.* into v_entitlement
  from public.game_account_entitlements entitlement
  where entitlement.entitlement_code in (
      'auth_identity_daily_attempt',
      'verified_email_daily_attempt'
    )
    and public.resolve_game_account_id(entitlement.account_id) = v_account_id
  order by
    case when entitlement.entitlement_code = 'auth_identity_daily_attempt' then 0 else 1 end,
    entitlement.granted_at,
    entitlement.account_id
  limit 1;

  if found then
    v_source := coalesce(
      v_entitlement.metadata->>'source',
      case when v_entitlement.entitlement_code = 'verified_email_daily_attempt'
        then 'email_confirmation'
        else 'social_link'
      end
    );
    if v_source = 'email_confirmation' then
      v_achievements := public.sync_game_verified_email_achievement(v_account_id);
    end if;
    return jsonb_build_object(
      'eligible', true,
      'active', true,
      'granted', false,
      'dailyAttemptBonus', 1,
      'source', v_source,
      'provider', coalesce(v_entitlement.metadata->>'provider', ''),
      'achievementCode', case when v_source = 'email_confirmation' then 'email_verified' else null end,
      'achievementTitle', case when v_source = 'email_confirmation' then 'Cuenta confirmada' else null end,
      'achievementsGranted', v_achievements
    );
  end if;

  select identity.* into v_origin
  from public.game_auth_identities identity
  where public.resolve_game_account_id(identity.account_id) = v_account_id
  order by identity.created_at, identity.auth_user_id
  limit 1;

  if not found then
    return jsonb_build_object(
      'eligible', false,
      'active', false,
      'granted', false,
      'dailyAttemptBonus', 0
    );
  end if;

  v_origin_provider := coalesce(v_origin.origin_provider, v_origin.provider);
  if v_origin_provider = 'email' and v_origin.email_verified_at is null then
    return jsonb_build_object(
      'eligible', true,
      'active', false,
      'granted', false,
      'pendingConfirmation', true,
      'dailyAttemptBonus', 0,
      'source', 'email_confirmation',
      'provider', 'email'
    );
  end if;

  if v_origin_provider = 'email' then
    v_source := 'email_confirmation';
  elsif v_origin_provider in ('google', 'facebook') then
    v_source := 'social_link';
  else
    return jsonb_build_object(
      'eligible', false,
      'active', false,
      'granted', false,
      'dailyAttemptBonus', 0
    );
  end if;

  insert into public.game_account_entitlements(
    account_id,
    entitlement_code,
    auth_user_id,
    metadata
  ) values (
    v_account_id,
    'auth_identity_daily_attempt',
    p_auth_user_id,
    jsonb_build_object(
      'dailyAttemptBonus', 1,
      'source', v_source,
      'provider', v_origin_provider
    )
  )
  on conflict (account_id, entitlement_code) do nothing;

  get diagnostics v_inserted = row_count;
  if v_source = 'email_confirmation' then
    v_achievements := public.sync_game_verified_email_achievement(v_account_id);
  end if;

  return jsonb_build_object(
    'eligible', true,
    'active', true,
    'granted', v_inserted = 1,
    'dailyAttemptBonus', 1,
    'source', v_source,
    'provider', v_origin_provider,
    'achievementCode', case when v_source = 'email_confirmation' then 'email_verified' else null end,
    'achievementTitle', case when v_source = 'email_confirmation' then 'Cuenta confirmada' else null end,
    'achievementsGranted', v_achievements
  );
end;
$$;

create or replace function public.grant_game_verified_email_reward(p_auth_user_id uuid)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select public.grant_game_auth_link_reward(p_auth_user_id);
$$;

revoke all on function public.record_game_auth_origin(uuid, text) from public, anon, authenticated;
revoke all on function public.game_account_auth_daily_bonus(uuid) from public, anon, authenticated;
revoke all on function public.sync_game_verified_email_achievement(uuid) from public, anon, authenticated;
revoke all on function public.grant_game_auth_link_reward(uuid) from public, anon, authenticated;
revoke all on function public.grant_game_verified_email_reward(uuid) from public, anon, authenticated;
grant execute on function public.record_game_auth_origin(uuid, text) to service_role;
grant execute on function public.game_account_auth_daily_bonus(uuid) to service_role;
grant execute on function public.sync_game_verified_email_achievement(uuid) to service_role;
grant execute on function public.grant_game_auth_link_reward(uuid) to service_role;
grant execute on function public.grant_game_verified_email_reward(uuid) to service_role;
