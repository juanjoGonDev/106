alter table public.game_leagues
  add column if not exists public_id text;

update public.game_leagues
set public_id = code
where public_id is null;

alter table public.game_leagues
  alter column public_id set not null;

create unique index if not exists game_leagues_public_id_key
  on public.game_leagues(public_id);

create or replace function public.generate_game_league_token()
returns text
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_token text;
  v_random_bytes bytea;
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  loop
    v_random_bytes := extensions.gen_random_bytes(6);
    select string_agg(
      substr(v_alphabet, (get_byte(v_random_bytes, byte_index) % 32) + 1, 1),
      '' order by byte_index
    ) into v_token
    from generate_series(0, 5) as byte_index;

    exit when not exists (
      select 1
      from public.game_leagues league
      where league.code = v_token or league.public_id = v_token
    );
  end loop;

  return v_token;
end;
$$;

update public.game_leagues
set code = public.generate_game_league_token()
where code = public_id;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'game_leagues_public_id_format_check'
      and conrelid = 'public.game_leagues'::regclass
  ) then
    alter table public.game_leagues
      add constraint game_leagues_public_id_format_check
      check (public_id ~ '^[A-Z0-9]{6}$');
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'game_leagues_private_public_distinct_check'
      and conrelid = 'public.game_leagues'::regclass
  ) then
    alter table public.game_leagues
      add constraint game_leagues_private_public_distinct_check
      check (code <> public_id);
  end if;
end;
$$;

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
    'league_podium'
  ));

create index if not exists game_attempts_progression_player_idx
  on public.game_attempts(nick_key, verified, difference_ms, created_at);

create index if not exists game_duels_progression_challenger_idx
  on public.game_duels(challenger_nick_key, created_at, completed_at);

create index if not exists game_duels_progression_opponent_idx
  on public.game_duels(opponent_nick_key, status, completed_at);

create or replace function public.refresh_game_player_progression_achievements(p_nick_key text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inserted integer := 0;
  v_total integer := 0;
begin
  if not exists (select 1 from public.game_players where nick_key = p_nick_key) then
    return 0;
  end if;

  insert into public.game_player_achievements(
    nick_key, achievement_code, achievement_kind, title, description,
    points, achieved_on, metadata
  )
  with ordered_perfect as (
    select attempt.created_at,
      row_number() over(order by attempt.created_at, attempt.id) as sequence
    from public.game_attempts attempt
    where attempt.nick_key = p_nick_key
      and attempt.verified = true
      and attempt.difference_ms = 0
  )
  select p_nick_key,
    'perfect_total_' || threshold.threshold,
    'perfect_total',
    case threshold.threshold
      when 1 then 'Primer latido perfecto'
      when 3 then 'El reloj te reconoce'
      when 5 then 'Precisión repetible'
      when 10 then 'Reloj dominado'
      when 25 then 'Dueño del segundo'
      when 50 then 'Cronómetro rendido'
      else 'Cien veces perfecto'
    end,
    case threshold.threshold
      when 1 then 'Clavaste exactamente 10.600 en un intento verificado.'
      else 'Acumulaste ' || threshold.threshold || ' intentos verificados exactamente en 10.600.'
    end,
    threshold.points,
    (reached.created_at at time zone 'Europe/Madrid')::date,
    jsonb_build_object('threshold', threshold.threshold)
  from (values
    (1, 15), (3, 25), (5, 40), (10, 75), (25, 140), (50, 240), (100, 400)
  ) as threshold(threshold, points)
  join ordered_perfect reached on reached.sequence = threshold.threshold
  on conflict (nick_key, achievement_code) do nothing;
  get diagnostics v_inserted = row_count;
  v_total := v_total + v_inserted;

  insert into public.game_player_achievements(
    nick_key, achievement_code, achievement_kind, title, description,
    points, achieved_on, metadata
  )
  select p_nick_key,
    'perfect_average',
    'perfect_average',
    'Media imposible',
    'Mantienes una media exacta de 0 ms tras al menos tres intentos verificados.',
    120,
    (max(attempt.created_at) at time zone 'Europe/Madrid')::date,
    jsonb_build_object('minimumAttempts', 3, 'averageDifferenceMs', 0)
  from public.game_attempts attempt
  where attempt.nick_key = p_nick_key
    and attempt.verified = true
  having count(*) >= 3 and round(avg(attempt.difference_ms)) = 0
  on conflict (nick_key, achievement_code) do nothing;
  get diagnostics v_inserted = row_count;
  v_total := v_total + v_inserted;

  insert into public.game_player_achievements(
    nick_key, achievement_code, achievement_kind, title, description,
    points, achieved_on, metadata
  )
  with ordered_verified as (
    select attempt.created_at,
      row_number() over(order by attempt.created_at, attempt.id) as sequence
    from public.game_attempts attempt
    where attempt.nick_key = p_nick_key
      and attempt.verified = true
  )
  select p_nick_key,
    'verified_total_' || threshold.threshold,
    'verified_total',
    case threshold.threshold
      when 5 then 'Primera tanda completa'
      when 10 then 'Doble prórroga'
      when 25 then 'Rodaje competitivo'
      when 50 then 'Veterano del 106'
      when 100 then 'Centenario'
      when 250 then 'Ritmo profesional'
      else 'Leyenda persistente'
    end,
    'Completaste ' || threshold.threshold || ' intentos verificados entre el global y tus ligas.',
    threshold.points,
    (reached.created_at at time zone 'Europe/Madrid')::date,
    jsonb_build_object('threshold', threshold.threshold)
  from (values
    (5, 10), (10, 18), (25, 35), (50, 60), (100, 110), (250, 220), (500, 380)
  ) as threshold(threshold, points)
  join ordered_verified reached on reached.sequence = threshold.threshold
  on conflict (nick_key, achievement_code) do nothing;
  get diagnostics v_inserted = row_count;
  v_total := v_total + v_inserted;

  insert into public.game_player_achievements(
    nick_key, achievement_code, achievement_kind, title, description,
    points, achieved_on, metadata
  )
  with precision_thresholds as (
    select * from (values
      (1000, 5, 'Dentro del segundo', 'Registraste una marca global a un segundo o menos del 10.600.'),
      (250, 10, 'Zona de precisión', 'Registraste una marca global a 250 ms o menos del 10.600.'),
      (100, 20, 'Pulso de élite', 'Registraste una marca global a 100 ms o menos del 10.600.'),
      (50, 35, 'Rozando el instante', 'Registraste una marca global a 50 ms o menos del 10.600.'),
      (10, 65, 'Margen histórico', 'Registraste una marca global a 10 ms o menos del 10.600.')
    ) as values_table(threshold, points, title, description)
  )
  select p_nick_key,
    'precision_' || threshold.threshold,
    'precision',
    threshold.title,
    threshold.description,
    threshold.points,
    (reached.created_at at time zone 'Europe/Madrid')::date,
    jsonb_build_object('thresholdMs', threshold.threshold)
  from precision_thresholds threshold
  join lateral (
    select attempt.created_at
    from public.game_attempts attempt
    where attempt.nick_key = p_nick_key
      and attempt.verified = true
      and attempt.league_id is null
      and attempt.difference_ms <= threshold.threshold
    order by attempt.created_at, attempt.id
    limit 1
  ) reached on true
  on conflict (nick_key, achievement_code) do nothing;
  get diagnostics v_inserted = row_count;
  v_total := v_total + v_inserted;

  insert into public.game_player_achievements(
    nick_key, achievement_code, achievement_kind, title, description,
    points, achieved_on, metadata
  )
  with ordered_referrals as (
    select referral.completed_at,
      row_number() over(order by referral.completed_at, referral.id) as sequence
    from public.game_referrals referral
    where referral.referrer_nick_key = p_nick_key
      and referral.completed_at is not null
  )
  select p_nick_key,
    'referral_total_' || threshold.threshold,
    'referral_total',
    case threshold.threshold
      when 1 then 'Primer fichaje'
      when 3 then 'Convocatoria completa'
      when 10 then 'Vestuario lleno'
      when 25 then 'Capitán de comunidad'
      else 'Estadio lleno'
    end,
    'Conseguiste que ' || threshold.threshold || ' jugadores invitados completaran su tanda global.',
    threshold.points,
    (reached.completed_at at time zone 'Europe/Madrid')::date,
    jsonb_build_object('threshold', threshold.threshold)
  from (values (1, 15), (3, 30), (10, 70), (25, 140), (50, 260)) as threshold(threshold, points)
  join ordered_referrals reached on reached.sequence = threshold.threshold
  on conflict (nick_key, achievement_code) do nothing;
  get diagnostics v_inserted = row_count;
  v_total := v_total + v_inserted;

  insert into public.game_player_achievements(
    nick_key, achievement_code, achievement_kind, title, description,
    points, achieved_on, metadata
  )
  with ordered_duels as (
    select duel.created_at,
      row_number() over(order by duel.created_at, duel.id) as sequence
    from public.game_duels duel
    where duel.challenger_nick_key = p_nick_key
  )
  select p_nick_key,
    'duel_created_' || threshold.threshold,
    'duel_created',
    case threshold.threshold
      when 1 then 'Guante lanzado'
      when 5 then 'Retador habitual'
      when 10 then 'Sin miedo al reloj'
      when 50 then 'Maestro del desafío'
      else 'Cien retos abiertos'
    end,
    'Creaste ' || threshold.threshold || ' retos directos a partir de una marca global verificada.',
    threshold.points,
    (reached.created_at at time zone 'Europe/Madrid')::date,
    jsonb_build_object('threshold', threshold.threshold)
  from (values (1, 8), (5, 20), (10, 35), (50, 100), (100, 180)) as threshold(threshold, points)
  join ordered_duels reached on reached.sequence = threshold.threshold
  on conflict (nick_key, achievement_code) do nothing;
  get diagnostics v_inserted = row_count;
  v_total := v_total + v_inserted;

  insert into public.game_player_achievements(
    nick_key, achievement_code, achievement_kind, title, description,
    points, achieved_on, metadata
  )
  with won_duels as (
    select duel.completed_at,
      row_number() over(order by duel.completed_at, duel.id) as sequence
    from public.game_duels duel
    where duel.status = 'completed'
      and duel.completed_at is not null
      and (
        (
          duel.challenger_nick_key = p_nick_key
          and coalesce(duel.opponent_best_difference_ms, 2147483647) >= duel.challenger_best_difference_ms
        )
        or (
          duel.opponent_nick_key = p_nick_key
          and duel.opponent_best_difference_ms < duel.challenger_best_difference_ms
        )
      )
  )
  select p_nick_key,
    'duel_wins_' || threshold.threshold,
    'duel_wins',
    case threshold.threshold
      when 1 then 'Primer duelo ganado'
      when 5 then 'Cinco rivales atrás'
      when 10 then 'Invicto en la prórroga'
      when 50 then 'Dominador de duelos'
      else 'Leyenda del cara a cara'
    end,
    'Ganaste ' || threshold.threshold || ' retos directos resueltos.',
    threshold.points,
    (reached.completed_at at time zone 'Europe/Madrid')::date,
    jsonb_build_object('threshold', threshold.threshold)
  from (values (1, 20), (5, 55), (10, 100), (50, 260), (100, 450)) as threshold(threshold, points)
  join won_duels reached on reached.sequence = threshold.threshold
  on conflict (nick_key, achievement_code) do nothing;
  get diagnostics v_inserted = row_count;
  v_total := v_total + v_inserted;

  insert into public.game_player_achievements(
    nick_key, achievement_code, achievement_kind, title, description,
    points, achieved_on, metadata
  )
  with completed_leagues as (
    select league.id, league.public_id, league.ends_at,
      row_number() over(order by league.ends_at, league.id) as sequence
    from public.game_leagues league
    join public.game_league_trophies trophy on trophy.league_id = league.id
    where exists (
      select 1
      from public.game_attempts attempt
      where attempt.league_id = league.id
        and attempt.nick_key = p_nick_key
        and attempt.verified = true
    )
  )
  select p_nick_key,
    'league_participation_' || threshold.threshold,
    'league_participation',
    case threshold.threshold
      when 1 then 'Debut en liga'
      when 5 then 'Jugador de liga'
      when 10 then 'Calendario completo'
      else 'Trotamundos del 106'
    end,
    'Competiste con una marca verificada en ' || threshold.threshold || ' ligas elegibles finalizadas.',
    threshold.points,
    (reached.ends_at at time zone 'Europe/Madrid')::date,
    jsonb_build_object('threshold', threshold.threshold)
  from (values (1, 12), (5, 35), (10, 70), (25, 160)) as threshold(threshold, points)
  join completed_leagues reached on reached.sequence = threshold.threshold
  on conflict (nick_key, achievement_code) do nothing;
  get diagnostics v_inserted = row_count;
  v_total := v_total + v_inserted;

  insert into public.game_player_achievements(
    nick_key, achievement_code, achievement_kind, title, description,
    points, achieved_on, metadata
  )
  with completed_leagues as (
    select league.id, league.public_id, league.name, league.ends_at
    from public.game_leagues league
    join public.game_league_trophies trophy on trophy.league_id = league.id
  ), member_best as (
    select league.id as league_id, league.public_id, league.name, league.ends_at,
      member.nick_key,
      min(attempt.difference_ms)::integer as best_difference_ms,
      min(attempt.created_at) filter (
        where attempt.difference_ms = (
          select min(best_attempt.difference_ms)
          from public.game_attempts best_attempt
          where best_attempt.league_id = league.id
            and best_attempt.nick_key = member.nick_key
            and best_attempt.verified = true
        )
      ) as best_at
    from completed_leagues league
    join public.game_league_members member on member.league_id = league.id
    join public.game_attempts attempt on attempt.league_id = league.id
      and attempt.nick_key = member.nick_key
      and attempt.verified = true
    group by league.id, league.public_id, league.name, league.ends_at, member.nick_key
  ), podium as (
    select member_best.*,
      row_number() over(
        partition by league_id
        order by best_difference_ms, best_at, nick_key
      )::integer as position
    from member_best
  )
  select p_nick_key,
    'league_podium_' || podium.public_id,
    'league_podium',
    case podium.position
      when 1 then 'Campeón de liga'
      when 2 then 'Subcampeón de liga'
      else 'Podio de liga'
    end,
    case podium.position
      when 1 then 'Ganaste la liga “' || podium.name || '” con la mejor marca verificada.'
      when 2 then 'Terminaste segundo en la liga “' || podium.name || '”.'
      else 'Terminaste entre los tres mejores de la liga “' || podium.name || '”.'
    end,
    case podium.position when 1 then 60 when 2 then 35 else 20 end,
    (podium.ends_at at time zone 'Europe/Madrid')::date,
    jsonb_build_object(
      'leaguePublicId', podium.public_id,
      'leagueName', podium.name,
      'position', podium.position,
      'bestDifferenceMs', podium.best_difference_ms
    )
  from podium
  where podium.nick_key = p_nick_key
    and podium.position <= 3
  on conflict (nick_key, achievement_code) do nothing;
  get diagnostics v_inserted = row_count;
  v_total := v_total + v_inserted;

  return v_total;
end;
$$;

create or replace function public.refresh_game_attempt_progression_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.refresh_game_player_progression_achievements(new.nick_key);
  return new;
end;
$$;

drop trigger if exists game_attempts_refresh_progression on public.game_attempts;
create trigger game_attempts_refresh_progression
after insert or update of verified, difference_ms on public.game_attempts
for each row execute function public.refresh_game_attempt_progression_trigger();

create or replace function public.refresh_game_duel_progression_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.refresh_game_player_progression_achievements(new.challenger_nick_key);
  if new.opponent_nick_key is not null then
    perform public.refresh_game_player_progression_achievements(new.opponent_nick_key);
  end if;
  return new;
end;
$$;

drop trigger if exists game_duels_refresh_progression on public.game_duels;
create trigger game_duels_refresh_progression
after insert or update of status, opponent_nick_key, opponent_best_difference_ms on public.game_duels
for each row execute function public.refresh_game_duel_progression_trigger();

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
  v_public_id text;
  v_account_id uuid;
  v_identity_device_hash text;
begin
  if char_length(trim(p_name)) not between 3 and 40 then
    return jsonb_build_object('error', 'invalid_league_name');
  end if;

  select account_player.account_id, player.first_device_hash
  into v_account_id, v_identity_device_hash
  from public.game_account_players account_player
  join public.game_players player on player.nick_key = account_player.nick_key
  where account_player.nick_key = p_owner_nick_key;

  if v_account_id is null or v_identity_device_hash is null then
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

  v_public_id := public.generate_game_league_token();
  v_code := public.generate_game_league_token();
  while v_code = v_public_id loop
    v_code := public.generate_game_league_token();
  end loop;

  insert into public.game_leagues(
    code,
    public_id,
    name,
    owner_nick_key,
    owner_device_hash,
    starts_at,
    ends_at,
    activated_at
  ) values (
    v_code,
    v_public_id,
    trim(p_name),
    p_owner_nick_key,
    p_device_hash,
    clock_timestamp(),
    clock_timestamp(),
    null
  ) returning id into v_id;

  insert into public.game_league_members(league_id, nick_key, account_id, device_hash)
  values (v_id, p_owner_nick_key, v_account_id, v_identity_device_hash)
  on conflict (league_id, nick_key) do nothing;

  return jsonb_build_object(
    'publicId', v_public_id,
    'joinCode', v_code,
    'name', trim(p_name)
  ) || public.activate_game_league_if_eligible(v_id);
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
  v_identity_device_hash text;
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

  select account_player.account_id, player.first_device_hash
  into v_account_id, v_identity_device_hash
  from public.game_account_players account_player
  join public.game_players player on player.nick_key = account_player.nick_key
  where account_player.nick_key = p_nick_key;

  if v_account_id is null or v_identity_device_hash is null then
    return jsonb_build_object('error', 'player_access_denied');
  end if;

  insert into public.game_league_members(league_id, nick_key, account_id, device_hash)
  values (v_league.id, p_nick_key, v_account_id, v_identity_device_hash)
  on conflict (league_id, nick_key) do update
    set account_id = coalesce(public.game_league_members.account_id, excluded.account_id),
        device_hash = coalesce(public.game_league_members.device_hash, excluded.device_hash);

  v_state := public.activate_game_league_if_eligible(v_league.id);
  return jsonb_build_object(
    'publicId', v_league.public_id,
    'name', v_league.name
  ) || v_state;
end;
$$;

create or replace function public.join_game_league(p_code text, p_nick_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity_device_hash text;
begin
  select player.first_device_hash into v_identity_device_hash
  from public.game_players player
  where player.nick_key = p_nick_key;

  if v_identity_device_hash is null then
    return jsonb_build_object('error', 'player_access_denied');
  end if;

  return public.join_game_league(p_code, p_nick_key, v_identity_device_hash);
end;
$$;

create or replace function public.get_game_public_league(p_public_id text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
with selected_league as (
  select league.*
  from public.game_leagues league
  where league.public_id = upper(trim(p_public_id))
), member_stats as (
  select member.nick_key, player.nick, member.joined_at,
    count(attempt.id)::integer as attempts_used,
    count(attempt.id) filter (where attempt.verified = true)::integer as verified_attempts,
    min(attempt.difference_ms) filter (where attempt.verified = true)::integer as best_difference_ms,
    min(attempt.created_at) filter (where attempt.verified = true)::timestamptz as best_at
  from selected_league league
  join public.game_league_members member on member.league_id = league.id
  join public.game_players player on player.nick_key = member.nick_key
  left join public.game_attempts attempt on attempt.league_id = league.id and attempt.nick_key = member.nick_key
  group by member.nick_key, player.nick, member.joined_at
), ranked as (
  select *, case when best_difference_ms is null then null else
    row_number() over(order by best_difference_ms, best_at, joined_at, nick_key)::integer end as rank
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
    'publicId', league.public_id,
    'name', league.name,
    'createdAt', league.created_at,
    'members', (select count(*)::integer from ranked),
    'participantCount', (select count(*)::integer from ranked),
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
  ) || public.get_game_league_status(league.id)
  from selected_league league
  cross join revision
), '{}'::jsonb);
$$;

create or replace function public.get_game_public_league_by_competition_code(p_code text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.get_game_public_league(league.public_id)
  from public.game_leagues league
  where league.code = upper(trim(p_code));
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
      min(attempt.difference_ms) filter (where attempt.verified = true)::integer as best_difference_ms,
      min(attempt.created_at) filter (where attempt.verified = true)::timestamptz as best_at
    from public.game_league_members member
    left join public.game_attempts attempt
      on attempt.league_id = member.league_id and attempt.nick_key = member.nick_key
    where member.league_id = v_league.id
    group by member.nick_key, member.joined_at
  ), ranked as (
    select nick_key, case when best_difference_ms is null then null else
      row_number() over(order by best_difference_ms, best_at, joined_at, nick_key)::integer end as rank
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

  return jsonb_build_object(
    'member', true,
    'publicId', v_league.public_id,
    'name', v_league.name,
    'attemptsUsed', v_attempts,
    'attemptsLeft', greatest(0, 5 - v_attempts),
    'maxAttempts', 5,
    'verifiedAttempts', v_verified,
    'bestDifferenceMs', v_best,
    'rank', v_rank,
    'history', v_history
  ) || public.get_game_league_status(v_league.id);
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
    min(attempt.difference_ms) filter (where attempt.verified = true)::integer as best_difference_ms,
    min(attempt.created_at) filter (where attempt.verified = true)::timestamptz as best_at
  from public.game_league_members member
  join memberships league on league.id = member.league_id
  left join public.game_attempts attempt
    on attempt.league_id = member.league_id and attempt.nick_key = member.nick_key
  group by member.league_id, member.nick_key, member.joined_at
), ranked as (
  select league_id, nick_key, case when best_difference_ms is null then null else
    row_number() over(partition by league_id order by best_difference_ms, best_at, joined_at, nick_key)::integer end as rank
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
    'publicId', league.public_id,
    'competitionCode', league.code,
    'joinCode', case when league.owner_nick_key = p_nick_key then league.code else null end,
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
  ) || public.get_game_league_status(league.id)
  order by (league.activated_at is null) desc,
    (league.activated_at is not null and league.ends_at > clock_timestamp()) desc,
    league.created_at desc
), '[]'::jsonb)
from memberships league
join summaries summary on summary.id = league.id
left join ranked on ranked.league_id = league.id and ranked.nick_key = p_nick_key;
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
  v_member record;
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
      for v_member in
        select member.nick_key
        from public.game_league_members member
        where member.league_id = v_league.id
      loop
        perform public.refresh_game_player_progression_achievements(v_member.nick_key);
      end loop;
    end if;
  end loop;

  return v_inserted;
end;
$$;

create or replace function public.get_game_global_player_rank(p_nick_key text)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
with player_summary as (
  select attempt.nick_key,
    count(*)::integer as verified_attempts,
    round(avg(attempt.difference_ms))::integer as average_difference_ms,
    min(attempt.difference_ms)::integer as best_difference_ms
  from public.game_attempts attempt
  where attempt.verified = true and attempt.league_id is null
  group by attempt.nick_key
), best_attempt as (
  select distinct on (attempt.nick_key)
    attempt.nick_key, attempt.created_at as best_at
  from public.game_attempts attempt
  where attempt.verified = true and attempt.league_id is null
  order by attempt.nick_key, attempt.difference_ms, attempt.created_at, attempt.id
), achievement_counts as (
  select achievement.nick_key, coalesce(sum(achievement.points), 0)::integer as achievement_points
  from public.game_player_achievements achievement
  group by achievement.nick_key
), daily_counts as (
  select trophy.nick_key, count(*)::integer as daily_trophies
  from public.game_daily_trophies trophy
  group by trophy.nick_key
), league_counts as (
  select trophy.nick_key, count(*)::integer as league_wins
  from public.game_league_trophies trophy
  group by trophy.nick_key
), ranked as (
  select summary.nick_key,
    row_number() over(order by
      summary.best_difference_ms,
      coalesce(achievement.achievement_points, 0) desc,
      coalesce(daily.daily_trophies, 0) desc,
      coalesce(league.league_wins, 0) desc,
      summary.verified_attempts desc,
      summary.average_difference_ms,
      best.best_at,
      summary.nick_key
    )::integer as rank
  from player_summary summary
  join best_attempt best using (nick_key)
  left join achievement_counts achievement using (nick_key)
  left join daily_counts daily using (nick_key)
  left join league_counts league using (nick_key)
)
select rank from ranked where nick_key = p_nick_key;
$$;

create or replace function public.get_game_stats()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  perform public.sync_game_trophy_history();
  perform public.sync_game_league_trophies();

  with global_verified as (
    select attempt.*
    from public.game_attempts attempt
    where attempt.verified = true and attempt.league_id is null
  ), player_summary as (
    select attempt.nick_key,
      max(attempt.nick) as nick,
      count(*)::integer as verified_attempts,
      round(avg(attempt.difference_ms))::integer as average_difference_ms,
      min(attempt.difference_ms)::integer as best_difference_ms
    from global_verified attempt
    group by attempt.nick_key
  ), best_attempt as (
    select distinct on (attempt.nick_key)
      attempt.id, attempt.nick, attempt.nick_key, attempt.team,
      attempt.client_elapsed_ms, attempt.difference_ms, attempt.created_at as best_at
    from global_verified attempt
    order by attempt.nick_key, attempt.difference_ms, attempt.created_at, attempt.id
  ), achievement_counts as (
    select achievement.nick_key, count(*)::integer as total_achievements,
      coalesce(sum(achievement.points), 0)::integer as achievement_points
    from public.game_player_achievements achievement
    group by achievement.nick_key
  ), daily_counts as (
    select trophy.nick_key, count(*)::integer as daily_trophies
    from public.game_daily_trophies trophy
    group by trophy.nick_key
  ), league_counts as (
    select trophy.nick_key, count(*)::integer as league_wins
    from public.game_league_trophies trophy
    group by trophy.nick_key
  ), ranked_players as (
    select best.id, best.nick, best.nick_key, best.team,
      best.client_elapsed_ms, best.difference_ms, best.best_at,
      summary.verified_attempts, summary.average_difference_ms,
      coalesce(achievement.total_achievements, 0) as total_achievements,
      coalesce(achievement.achievement_points, 0) as achievement_points,
      coalesce(daily.daily_trophies, 0) as daily_trophies,
      coalesce(league.league_wins, 0) as league_wins,
      count(*) over(partition by best.difference_ms)::integer as same_time_players,
      row_number() over(order by
        best.difference_ms,
        coalesce(achievement.achievement_points, 0) desc,
        coalesce(daily.daily_trophies, 0) desc,
        coalesce(league.league_wins, 0) desc,
        summary.verified_attempts desc,
        summary.average_difference_ms,
        best.best_at,
        best.nick_key
      )::integer as rank
    from best_attempt best
    join player_summary summary using (nick_key)
    left join achievement_counts achievement using (nick_key)
    left join daily_counts daily using (nick_key)
    left join league_counts league using (nick_key)
  ), team_best as (
    select distinct on (attempt.team, attempt.nick_key)
      attempt.id, attempt.nick_key, attempt.team, attempt.difference_ms
    from global_verified attempt
    order by attempt.team, attempt.nick_key, attempt.difference_ms, attempt.created_at, attempt.id
  ), team_list(team) as (values ('spain'::text), ('argentina'::text)), team_stats as (
    select teams.team,
      (select count(*)::integer from public.game_attempts attempt where attempt.team = teams.team and attempt.league_id is null) as attempts,
      count(best.id)::integer as players,
      case when count(best.id) > 0 then round(avg(best.difference_ms))::integer else null end as average_difference_ms,
      coalesce(sum(greatest(1, 100 - floor(best.difference_ms / 10.0)::integer)), 0)::bigint as score
    from team_list teams
    left join team_best best on best.team = teams.team
    group by teams.team
  )
  select jsonb_build_object(
    'targetMs', 10600,
    'maxAttemptsPerNick', 5,
    'scoreVersion', 3,
    'scoreMaxPerPlayer', 100,
    'rankingVersion', 2,
    'rankingOrder', jsonb_build_array(
      'bestDifferenceMs', 'achievementPoints', 'dailyTrophies', 'leagueWins',
      'verifiedAttempts', 'averageDifferenceMs', 'bestAt', 'nickKey'
    ),
    'totalAttempts', (select count(*)::integer from public.game_attempts where league_id is null),
    'verifiedAttempts', (select count(*)::integer from global_verified),
    'totalPlayers', (select count(*)::integer from player_summary),
    'perfectAttempts', (select count(*)::integer from global_verified where difference_ms = 0),
    'teams', coalesce((select jsonb_agg(jsonb_build_object(
      'team', team,
      'attempts', attempts,
      'players', players,
      'averageDifferenceMs', average_difference_ms,
      'score', score
    ) order by case team when 'spain' then 1 else 2 end) from team_stats), '[]'::jsonb),
    'leaderboard', coalesce((select jsonb_agg(jsonb_build_object(
      'rank', rank,
      'id', id,
      'nick', nick,
      'team', team,
      'elapsedMs', client_elapsed_ms,
      'differenceMs', difference_ms,
      'createdAt', best_at,
      'achievementPoints', achievement_points,
      'totalAchievements', total_achievements,
      'dailyTrophies', daily_trophies,
      'leagueWins', league_wins,
      'verifiedAttempts', verified_attempts,
      'averageDifferenceMs', average_difference_ms,
      'tiedOnTime', same_time_players > 1
    ) order by rank)
    from (select * from ranked_players order by rank limit 100) leaderboard), '[]'::jsonb),
    'honoursRankings', public.get_game_honours_rankings()
  ) into v_result;

  return v_result;
end;
$$;

alter function public.get_game_player_profile(text)
  rename to get_game_player_profile_before_progression;

create or replace function public.get_game_player_profile(p_nick_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile jsonb;
  v_history jsonb;
  v_league_history jsonb;
  v_rank integer;
  v_daily_trophies integer;
  v_league_wins integer;
begin
  perform public.sync_game_trophy_history();
  perform public.sync_game_league_trophies();
  perform public.refresh_game_player_progression_achievements(p_nick_key);

  v_profile := public.get_game_player_profile_before_progression(p_nick_key);
  if not coalesce(v_profile ? 'nick', false) then
    return v_profile;
  end if;

  select coalesce(jsonb_agg(
    case
      when item.value->>'type' = 'league_champion' then
        (item.value - 'leagueCode') || jsonb_build_object(
          'leaguePublicId', league.public_id
        )
      else item.value
    end
    order by item.ordinality
  ), '[]'::jsonb)
  into v_history
  from jsonb_array_elements(coalesce(v_profile #> '{trophies,history}', '[]'::jsonb))
    with ordinality as item(value, ordinality)
  left join public.game_leagues league on league.code = item.value->>'leagueCode';

  select coalesce(jsonb_agg(
    (item.value - 'leagueCode') || jsonb_build_object(
      'leaguePublicId', league.public_id
    )
    order by item.ordinality
  ), '[]'::jsonb)
  into v_league_history
  from jsonb_array_elements(coalesce(v_profile #> '{leagueTrophies,history}', '[]'::jsonb))
    with ordinality as item(value, ordinality)
  left join public.game_leagues league on league.code = item.value->>'leagueCode';

  select public.get_game_global_player_rank(p_nick_key) into v_rank;
  select count(*)::integer into v_daily_trophies
  from public.game_daily_trophies where nick_key = p_nick_key;
  select count(*)::integer into v_league_wins
  from public.game_league_trophies where nick_key = p_nick_key;

  v_profile := jsonb_set(v_profile, '{trophies,history}', v_history, true);
  v_profile := jsonb_set(v_profile, '{leagueTrophies,history}', v_league_history, true);
  v_profile := jsonb_set(v_profile, '{globalRankBest}', to_jsonb(v_rank), true);

  return v_profile || jsonb_build_object(
    'rankingTieBreak', jsonb_build_object(
      'achievementPoints', coalesce((v_profile #>> '{achievements,points}')::integer, 0),
      'dailyTrophies', coalesce(v_daily_trophies, 0),
      'leagueWins', coalesce(v_league_wins, 0),
      'verifiedAttempts', coalesce((v_profile->>'verifiedAttempts')::integer, 0)
    )
  );
end;
$$;

create or replace function public.get_game_public_profile(p_nick_key text)
returns jsonb
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  select public.get_game_player_profile(p_nick_key);
$$;

create or replace function public.get_game_public_attempt(p_attempt_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select jsonb_build_object(
      'id', attempt.id,
      'nick', attempt.nick,
      'team', attempt.team,
      'elapsedMs', attempt.client_elapsed_ms,
      'differenceMs', attempt.difference_ms,
      'verified', attempt.verified,
      'createdAt', attempt.created_at,
      'competitionType', case when attempt.league_id is null then 'global' else 'league' end,
      'leaguePublicId', league.public_id,
      'leagueName', league.name,
      'revision', floor(extract(epoch from attempt.created_at) * 1000)::bigint
    )
    from public.game_attempts attempt
    left join public.game_leagues league on league.id = attempt.league_id
    where attempt.id = p_attempt_id
  ), '{}'::jsonb);
$$;

do $$
declare
  v_player record;
begin
  for v_player in select player.nick_key from public.game_players player loop
    perform public.refresh_game_player_progression_achievements(v_player.nick_key);
  end loop;
end;
$$;

revoke all on function public.generate_game_league_token() from public, anon, authenticated;
revoke all on function public.refresh_game_player_progression_achievements(text) from public, anon, authenticated;
revoke all on function public.refresh_game_attempt_progression_trigger() from public, anon, authenticated;
revoke all on function public.refresh_game_duel_progression_trigger() from public, anon, authenticated;
revoke all on function public.create_game_league(text, text, text) from public, anon, authenticated;
revoke all on function public.join_game_league(text, text, text) from public, anon, authenticated;
revoke all on function public.join_game_league(text, text) from public, anon, authenticated;
revoke all on function public.get_game_public_league(text) from public, anon, authenticated;
revoke all on function public.get_game_public_league_by_competition_code(text) from public, anon, authenticated;
revoke all on function public.get_game_league_player_status(text, text) from public, anon, authenticated;
revoke all on function public.get_game_player_leagues(text) from public, anon, authenticated;
revoke all on function public.sync_game_league_trophies() from public, anon, authenticated;
revoke all on function public.get_game_global_player_rank(text) from public, anon, authenticated;
revoke all on function public.get_game_stats() from public, anon, authenticated;
revoke all on function public.get_game_player_profile_before_progression(text) from public, anon, authenticated;
revoke all on function public.get_game_player_profile(text) from public, anon, authenticated;
revoke all on function public.get_game_public_profile(text) from public, anon, authenticated;
revoke all on function public.get_game_public_attempt(uuid) from public, anon, authenticated;

grant execute on function public.generate_game_league_token() to service_role;
grant execute on function public.refresh_game_player_progression_achievements(text) to service_role;
grant execute on function public.create_game_league(text, text, text) to service_role;
grant execute on function public.join_game_league(text, text, text) to service_role;
grant execute on function public.join_game_league(text, text) to service_role;
grant execute on function public.get_game_public_league(text) to service_role;
grant execute on function public.get_game_public_league_by_competition_code(text) to service_role;
grant execute on function public.get_game_league_player_status(text, text) to service_role;
grant execute on function public.get_game_player_leagues(text) to service_role;
grant execute on function public.sync_game_league_trophies() to service_role;
grant execute on function public.get_game_global_player_rank(text) to service_role;
grant execute on function public.get_game_stats() to service_role;
grant execute on function public.get_game_player_profile_before_progression(text) to service_role;
grant execute on function public.get_game_player_profile(text) to service_role;
grant execute on function public.get_game_public_profile(text) to service_role;
grant execute on function public.get_game_public_attempt(uuid) to service_role;
