\set ON_ERROR_STOP on

insert into public.game_deployment_snapshots (
  commit_sha,
  workflow_run_id,
  phase,
  attempts,
  verified_attempts,
  players,
  referrals,
  completed_referrals,
  bonus_attempts,
  migration_version
)
select
  :'commit_sha',
  :'run_id',
  :'phase',
  (select count(*) from public.game_attempts),
  (select count(*) from public.game_attempts where verified = true),
  (select count(*) from public.game_players),
  (select count(*) from public.game_referrals),
  (select count(*) from public.game_referrals where completed_at is not null),
  (select coalesce(sum(bonus_attempts), 0) from public.game_player_bonus),
  (select max(version) from supabase_migrations.schema_migrations)
on conflict (workflow_run_id, phase) do update set
  commit_sha = excluded.commit_sha,
  attempts = excluded.attempts,
  verified_attempts = excluded.verified_attempts,
  players = excluded.players,
  referrals = excluded.referrals,
  completed_referrals = excluded.completed_referrals,
  bonus_attempts = excluded.bonus_attempts,
  migration_version = excluded.migration_version,
  created_at = clock_timestamp();
