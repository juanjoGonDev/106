alter table public.game_players
  add column if not exists access_token_hash text,
  add column if not exists access_token_created_at timestamptz;

create or replace function public.ensure_game_player_access(
  p_nick text,
  p_nick_key text,
  p_device_hash text,
  p_ip_hash text,
  p_token_hash text default null,
  p_new_token_hash text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_player public.game_players%rowtype;
begin
  if char_length(p_nick) not between 2 and 24
     or char_length(p_nick_key) not between 2 and 24 then
    return jsonb_build_object('error', 'invalid_input');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_nick_key, 106));
  select * into v_player from public.game_players where nick_key = p_nick_key for update;

  if not found then
    if p_new_token_hash is null or char_length(p_new_token_hash) < 32 then
      return jsonb_build_object('error', 'player_token_required');
    end if;
    insert into public.game_players(
      nick_key, nick, first_device_hash, first_ip_hash,
      access_token_hash, access_token_created_at
    ) values (
      p_nick_key, p_nick, p_device_hash, p_ip_hash,
      p_new_token_hash, clock_timestamp()
    );
    insert into public.game_player_bonus(nick_key) values (p_nick_key)
    on conflict (nick_key) do nothing;
    return jsonb_build_object('authorized', true, 'created', true);
  end if;

  if v_player.access_token_hash is null then
    if v_player.first_device_hash <> p_device_hash then
      return jsonb_build_object('error', 'player_claim_original_device');
    end if;
    if p_new_token_hash is null or char_length(p_new_token_hash) < 32 then
      return jsonb_build_object('error', 'player_token_required');
    end if;
    update public.game_players
      set nick = p_nick,
          access_token_hash = p_new_token_hash,
          access_token_created_at = clock_timestamp()
      where nick_key = p_nick_key;
    return jsonb_build_object('authorized', true, 'claimed', true);
  end if;

  if p_token_hash is null or v_player.access_token_hash <> p_token_hash then
    return jsonb_build_object('error', 'player_access_denied');
  end if;

  update public.game_players set nick = p_nick where nick_key = p_nick_key;
  return jsonb_build_object('authorized', true, 'created', false);
end;
$$;

create or replace function public.get_game_player_access_status(p_nick_key text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when not exists(select 1 from public.game_players where nick_key = p_nick_key)
      then jsonb_build_object('exists', false, 'protected', false)
    else jsonb_build_object(
      'exists', true,
      'protected', coalesce((select access_token_hash is not null from public.game_players where nick_key = p_nick_key), false)
    )
  end;
$$;

create or replace function public.reward_referred_player()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.completed_at is null and new.completed_at is not null then
    insert into public.game_player_bonus(nick_key, bonus_attempts, updated_at)
    values (new.referred_nick_key, 1, clock_timestamp())
    on conflict (nick_key) do update
      set bonus_attempts = public.game_player_bonus.bonus_attempts + 1,
          updated_at = excluded.updated_at;
  end if;
  return new;
end;
$$;

drop trigger if exists game_referral_reward_referred on public.game_referrals;
create trigger game_referral_reward_referred
after update of completed_at on public.game_referrals
for each row execute function public.reward_referred_player();

revoke all on function public.ensure_game_player_access(text,text,text,text,text,text) from public, anon, authenticated;
revoke all on function public.get_game_player_access_status(text) from public, anon, authenticated;
grant execute on function public.ensure_game_player_access(text,text,text,text,text,text) to service_role;
grant execute on function public.get_game_player_access_status(text) to service_role;