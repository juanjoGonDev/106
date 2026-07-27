alter table public.game_challenges
  alter column quota_day set default ((clock_timestamp() at time zone 'UTC')::date);

alter table public.game_attempts
  alter column quota_day set default ((clock_timestamp() at time zone 'UTC')::date);
