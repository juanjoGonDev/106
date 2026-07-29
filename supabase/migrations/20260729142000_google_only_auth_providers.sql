alter table public.game_auth_identities
  drop constraint if exists game_auth_identities_supported_provider_check;

alter table public.game_auth_identities
  add constraint game_auth_identities_supported_provider_check
  check (provider in ('email', 'google'))
  not valid;

alter table public.game_auth_identities
  drop constraint if exists game_auth_identities_supported_origin_provider_check;

alter table public.game_auth_identities
  add constraint game_auth_identities_supported_origin_provider_check
  check (origin_provider is null or origin_provider in ('email', 'google'))
  not valid;

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
  if p_auth_user_id is null or p_provider not in ('email', 'google') then
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

  if not found or v_identity.provider not in ('email', 'google') then
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
    and identity.provider in ('email', 'google')
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
  elsif v_origin_provider = 'google' then
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

revoke all on function public.record_game_auth_origin(uuid, text) from public, anon, authenticated;
revoke all on function public.grant_game_auth_link_reward(uuid) from public, anon, authenticated;
grant execute on function public.record_game_auth_origin(uuid, text) to service_role;
grant execute on function public.grant_game_auth_link_reward(uuid) to service_role;
