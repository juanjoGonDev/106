create table if not exists public.game_deployment_snapshots (
  id bigint generated always as identity primary key,
  commit_sha text not null check (char_length(commit_sha) between 7 and 64),
  workflow_run_id text not null,
  phase text not null check (phase in ('pre', 'post')),
  attempts bigint not null default 0,
  verified_attempts bigint not null default 0,
  players bigint not null default 0,
  referrals bigint not null default 0,
  completed_referrals bigint not null default 0,
  bonus_attempts bigint not null default 0,
  migration_version text,
  created_at timestamptz not null default clock_timestamp(),
  unique (workflow_run_id, phase)
);

create index if not exists game_deployment_snapshots_created_idx
  on public.game_deployment_snapshots(created_at desc);

alter table public.game_deployment_snapshots enable row level security;
revoke all on table public.game_deployment_snapshots from anon, authenticated;
grant all on table public.game_deployment_snapshots to service_role;

comment on table public.game_deployment_snapshots is
  'Non-sensitive aggregate counters recorded before and after production deployments.';
