revoke all on table public.game_attempt_integrity, public.game_attempt_integrity_events
  from public, anon, authenticated, service_role;

grant select, insert, update, delete on table public.game_attempt_integrity
  to service_role;
grant select, insert on table public.game_attempt_integrity_events
  to service_role;

grant usage, select on sequence public.game_attempt_integrity_events_id_seq
  to service_role;

comment on table public.game_attempt_integrity_events is
  'Append-only service-role audit ledger for integrity decisions. UPDATE and DELETE are intentionally not granted; raw game attempts remain the evidence source.';
