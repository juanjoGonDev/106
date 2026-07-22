create table if not exists public.game_trophy_award_runs (
  award_date date primary key,
  trophy_count integer not null default 0 check (trophy_count between 0 and 3),
  processed_at timestamptz not null default clock_timestamp()
);

create table if not exists public.game_daily_trophies (
  id uuid primary key default gen_random_uuid(),
  award_date date not null,
  trophy_type text not null check (trophy_type in ('golden_boot', 'golden_glove', 'golden_ball')),
  nick_key text not null references public.game_players(nick_key) on delete cascade,
  metric_value integer not null check (metric_value >= 0),
  attempt_count integer not null check (attempt_count > 0),
  best_difference_ms integer not null check (best_difference_ms >= 0),
  average_difference_ms integer not null check (average_difference_ms >= 0),
  awarded_at timestamptz not null default clock_timestamp(),
  unique (award_date, trophy_type)
);

create table if not exists public.game_player_achievements (
  id uuid primary key default gen_random_uuid(),
  nick_key text not null references public.game_players(nick_key) on delete cascade,
  achievement_code text not null,
  achievement_kind text not null check (achievement_kind in (
    'first_trophy',
    'trophy_total',
    'category_total',
    'trophy_streak',
    'first_of_month',
    'complete_set',
    'daily_hat_trick'
  )),
  title text not null,
  description text not null,
  points integer not null check (points > 0),
  achieved_on date not null,
  trophy_type text check (trophy_type is null or trophy_type in ('golden_boot', 'golden_glove', 'golden_ball')),
  metadata jsonb not null default '{}'::jsonb,
  awarded_at timestamptz not null default clock_timestamp(),
  unique (nick_key, achievement_code)
);

create index if not exists game_daily_trophies_player_date_idx
  on public.game_daily_trophies(nick_key, award_date desc, trophy_type);
create index if not exists game_daily_trophies_ranking_idx
  on public.game_daily_trophies(trophy_type, nick_key, award_date desc);
create index if not exists game_player_achievements_player_date_idx
  on public.game_player_achievements(nick_key, achieved_on desc, points desc);
create index if not exists game_player_achievements_ranking_idx
  on public.game_player_achievements(points desc, nick_key);
create index if not exists game_attempts_daily_trophy_idx
  on public.game_attempts (((created_at at time zone 'Europe/Madrid')::date), nick_key, difference_ms, created_at)
  where verified = true and league_id is null;

alter table public.game_trophy_award_runs enable row level security;
alter table public.game_daily_trophies enable row level security;
alter table public.game_player_achievements enable row level security;
revoke all on table public.game_trophy_award_runs, public.game_daily_trophies, public.game_player_achievements
  from public, anon, authenticated;
grant all on table public.game_trophy_award_runs, public.game_daily_trophies, public.game_player_achievements
  to service_role;

create or replace function public.game_trophy_label(p_trophy_type text)
returns text
language sql immutable security definer set search_path = public, pg_temp as $$
  select case p_trophy_type
    when 'golden_boot' then 'Bota de Oro'
    when 'golden_glove' then 'Guante de Oro'
    when 'golden_ball' then 'Balón de Oro'
    else 'Trofeo'
  end;
$$;
revoke all on function public.game_trophy_label(text) from public, anon, authenticated;
grant execute on function public.game_trophy_label(text) to service_role;
