alter table public.game_auth_identities
  add constraint game_auth_identities_auth_user_id_fkey
  foreign key (auth_user_id) references auth.users(id) on delete cascade;

alter function public.get_game_account_players(text) volatile;
