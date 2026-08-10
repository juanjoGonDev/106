grant select, insert, update, delete on table
  public.game_admin_login_failures,
  public.game_admin_sessions,
  public.game_admin_bans,
  public.game_admin_audit_events
to service_role;

comment on table public.game_admin_login_failures is
  'Server-owned zadmin brute-force evidence. Browser roles remain denied; service_role retains the repository-standard game table DML boundary.';
