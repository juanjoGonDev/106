alter table public.game_deployment_snapshots
  add column if not exists accounts bigint not null default 0,
  add column if not exists account_players bigint not null default 0;
