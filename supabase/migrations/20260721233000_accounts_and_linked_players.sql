create table if not exists public.game_accounts (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (char_length(token_hash) >= 32),
  created_at timestamptz not null default clock_timestamp(),
  last_used_at timestamptz not null default clock_timestamp()
);

create table if not exists public.game_account_players (
  account_id uuid not null references public.game_accounts(id) on delete cascade,
  nick_key text not null references public.game_players(nick_key) on delete cascade,
  linked_at timestamptz not null default clock_timestamp(),
  primary key (account_id, nick_key),
  unique (nick_key)
);

create index if not exists game_account_players_account_idx
  on public.game_account_players(account_id, linked_at desc);

alter table public.game_accounts enable row level security;
alter table public.game_account_players enable row level security;
revoke all on table public.game_accounts, public.game_account_players from anon, authenticated;
grant all on table public.game_accounts, public.game_account_players to service_role;

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
  v_account public.game_accounts%rowtype;
  v_player public.game_players%rowtype;
  v_link public.game_account_players%rowtype;
begin
  if char_length(p_nick) not between 2 and 24
     or char_length(p_nick_key) not between 2 and 24
     or char_length(coalesce(p_account_token_hash, '')) < 32 then
    return jsonb_build_object('error', 'invalid_input');
  end if;

  insert into public.game_accounts(token_hash)
  values (p_account_token_hash)
  on conflict (token_hash) do update
    set last_used_at = clock_timestamp()
  returning * into v_account;

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
    values (v_account.id, p_nick_key);

    return jsonb_build_object(
      'authorized', true,
      'created', true,
      'linked', true
    );
  end if;

  select * into v_link
  from public.game_account_players
  where nick_key = p_nick_key;

  if found then
    if v_link.account_id <> v_account.id then
      return jsonb_build_object('error', 'player_access_denied');
    end if;
    update public.game_players set nick = p_nick where nick_key = p_nick_key;
    return jsonb_build_object('authorized', true, 'created', false, 'linked', true);
  end if;

  if v_player.access_token_hash = p_account_token_hash
     or (p_legacy_token_hash is not null and v_player.access_token_hash = p_legacy_token_hash)
     or (v_player.access_token_hash is null and v_player.first_device_hash = p_device_hash) then
    insert into public.game_account_players(account_id, nick_key)
    values (v_account.id, p_nick_key);

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
    select id from public.game_accounts where token_hash = p_account_token_hash
  ), attempt_summary as (
    select
      a.nick_key,
      count(*)::integer as attempts_used,
      count(*) filter (where a.verified)::integer as verified_attempts,
      min(a.difference_ms) filter (where a.verified)::integer as best_difference_ms,
      round(avg(a.difference_ms) filter (where a.verified))::integer as average_difference_ms,
      (array_agg(a.team order by a.created_at desc))[1] as team
    from public.game_attempts a
    join public.game_account_players ap on ap.nick_key = a.nick_key
    join selected_account sa on sa.id = ap.account_id
    group by a.nick_key
  )
  select jsonb_build_object(
    'exists', exists(select 1 from selected_account),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'nick', p.nick,
        'nickKey', p.nick_key,
        'team', s.team,
        'attemptsUsed', coalesce(s.attempts_used, 0),
        'verifiedAttempts', coalesce(s.verified_attempts, 0),
        'bestDifferenceMs', s.best_difference_ms,
        'averageDifferenceMs', s.average_difference_ms,
        'bonusAttempts', coalesce(b.bonus_attempts, 0),
        'attemptsLeft', greatest(0, 5 + coalesce(b.bonus_attempts, 0) - coalesce(s.attempts_used, 0)),
        'linkedAt', ap.linked_at
      ) order by ap.linked_at desc)
      from selected_account sa
      join public.game_account_players ap on ap.account_id = sa.id
      join public.game_players p on p.nick_key = ap.nick_key
      left join attempt_summary s on s.nick_key = p.nick_key
      left join public.game_player_bonus b on b.nick_key = p.nick_key
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.ensure_game_account_player(text,text,text,text,text,text) from public, anon, authenticated;
revoke all on function public.get_game_account_players(text) from public, anon, authenticated;
grant execute on function public.ensure_game_account_player(text,text,text,text,text,text) to service_role;
grant execute on function public.get_game_account_players(text) to service_role;