-- Ensure the account-merge fingerprint functions can resolve pgcrypto.digest
-- while preserving their restricted SECURITY DEFINER search path.

alter function public.prepare_game_auth_link(uuid, text, text, boolean, text, text)
  set search_path = public, extensions, pg_temp;

alter function public.confirm_game_auth_merge(uuid, uuid, text)
  set search_path = public, extensions, pg_temp;
