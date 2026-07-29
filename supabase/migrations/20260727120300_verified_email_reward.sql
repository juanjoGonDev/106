create table if not exists public.game_account_entitlements (
  account_id uuid not null references public.game_accounts(id) on delete cascade,
  entitlement_code text not null,
  granted_at timestamptz not null default clock_timestamp(),
  auth_user_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  primary key (account_id, entitlement_code)
);

alter table public.game_account_entitlements enable row level security;
revoke all on table public.game_account_entitlements from public, anon, authenticated;
grant all on table public.game_account_entitlements to service_role;

alter table public.game_player_achievements
  drop constraint if exists game_player_achievements_achievement_kind_check;

alter table public.game_player_achievements
  add constraint game_player_achievements_achievement_kind_check
  check (achievement_kind in (
    'first_trophy',
    'trophy_total',
    'category_total',
    'trophy_streak',
    'first_of_month',
    'complete_set',
    'daily_hat_trick',
    'perfect_total',
    'perfect_average',
    'verified_total',
    'precision',
    'referral_total',
    'duel_created',
    'duel_wins',
    'league_participation',
    'league_podium',
    'email_verified'
  ));

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
    where entitlement.entitlement_code = 'verified_email_daily_attempt'
      and public.resolve_game_account_id(entitlement.account_id) = v_account_id
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

create or replace function public.grant_game_verified_email_reward(p_auth_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity public.game_auth_identities%rowtype;
  v_account_id uuid;
  v_inserted integer := 0;
  v_achievements integer := 0;
begin
  select identity.* into v_identity
  from public.game_auth_identities identity
  where identity.auth_user_id = p_auth_user_id
  for update;

  if not found
     or v_identity.provider <> 'email'
     or v_identity.email_verified_at is null then
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

  perform pg_advisory_xact_lock(hashtextextended('verified-email:' || v_account_id::text, 106));

  insert into public.game_account_entitlements(
    account_id,
    entitlement_code,
    auth_user_id,
    metadata
  ) values (
    v_account_id,
    'verified_email_daily_attempt',
    p_auth_user_id,
    jsonb_build_object('dailyAttemptBonus', 1, 'source', 'email_confirmation')
  )
  on conflict (account_id, entitlement_code) do nothing;

  get diagnostics v_inserted = row_count;
  v_achievements := public.sync_game_verified_email_achievement(v_account_id);

  return jsonb_build_object(
    'eligible', true,
    'active', true,
    'granted', v_inserted = 1,
    'dailyAttemptBonus', 1,
    'achievementCode', 'email_verified',
    'achievementTitle', 'Cuenta confirmada',
    'achievementsGranted', v_achievements
  );
end;
$$;

create or replace function public.sync_game_verified_email_achievement_on_link()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.sync_game_verified_email_achievement(new.account_id);
  return new;
end;
$$;

drop trigger if exists game_account_players_verified_email_achievement on public.game_account_players;
create trigger game_account_players_verified_email_achievement
after insert or update of account_id on public.game_account_players
for each row execute function public.sync_game_verified_email_achievement_on_link();

revoke all on function public.sync_game_verified_email_achievement(uuid) from public, anon, authenticated;
revoke all on function public.grant_game_verified_email_reward(uuid) from public, anon, authenticated;
revoke all on function public.sync_game_verified_email_achievement_on_link() from public, anon, authenticated;
grant execute on function public.sync_game_verified_email_achievement(uuid) to service_role;
grant execute on function public.grant_game_verified_email_reward(uuid) to service_role;
grant execute on function public.sync_game_verified_email_achievement_on_link() to service_role;
