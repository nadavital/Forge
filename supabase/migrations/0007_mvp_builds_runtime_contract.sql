-- Align mvp_builds with the dashboard build runtime contract.

alter table public.mvp_builds
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.mvp_builds
  drop constraint if exists mvp_builds_status_check;

alter table public.mvp_builds
  add constraint mvp_builds_status_check
  check (status in (
    'queued',
    'briefed',
    'blocked',
    'building',
    'reviewing',
    'completed',
    'failed',
    'in_progress'
  ));

notify pgrst, 'reload schema';
