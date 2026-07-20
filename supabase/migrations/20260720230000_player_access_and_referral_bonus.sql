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
set search_path