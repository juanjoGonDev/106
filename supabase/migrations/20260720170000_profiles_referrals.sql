alter table public.game_attempts add column if not exists client_signals jsonb not null default '{}'::jsonb;

create table if not exists public.game_player_bonus (
  nick_key text primary key,
  bonus_attempts integer not null default 0 check (bonus_attempts >= 0),
  updated_at timestamptz not null default clock_timestamp()
);

create table if not exists public.game_referrals (
  id uuid primary key default gen_random_uuid(),
  code