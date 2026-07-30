create or replace function public.game_server_day(p_at timestamptz)
returns date
language sql
stable
parallel safe
as $$
  select (p_at at time zone 'Europe/Madrid')::date;
$$;

create or replace function public.game_server_reset_at(p_day date)
returns timestamptz
language sql
stable
parallel safe
as $$
  select ((p_day + 1)::timestamp at time zone 'Europe/Madrid');
$$;

alter table public.game_challenges
  alter column quota_day set default public.game_server_day(clock_timestamp());

alter table public.game_attempts
  alter column quota_day set default public.game_server_day(clock_timestamp());

update public.game_challenges
set quota_day = public.game_server_day(started_at)
where league_id is null
  and quota_day is distinct from public.game_server_day(started_at);

update public.game_attempts
set quota_day = public.game_server_day(created_at)
where league_id is null
  and quota_day is distinct from public.game_server_day(created_at);

comment on function public.game_server_day(timestamptz) is
  'Returns the canonical Minuto 106 server day in Europe/Madrid, including daylight-saving transitions.';

comment on function public.game_server_reset_at(date) is
  'Returns the UTC instant corresponding to the next 00:00 Europe/Madrid daily reset.';
