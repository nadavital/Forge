-- Keep hosted Supabase constraints aligned with the dashboard runtime contract.

alter table public.pipeline_runs
  drop constraint if exists pipeline_runs_run_type_check;

alter table public.pipeline_runs
  add constraint pipeline_runs_run_type_check
  check (run_type in (
    'scan',
    'research',
    'ranking',
    'review',
    'build',
    'reflection',
    'fixture',
    'managed',
    'discovery'
  ));

alter table public.pipeline_runs
  drop constraint if exists pipeline_runs_status_check;

alter table public.pipeline_runs
  add constraint pipeline_runs_status_check
  check (status in (
    'queued',
    'running',
    'in_progress',
    'completed',
    'failed'
  ));

alter table public.pipeline_runs
  drop constraint if exists pipeline_runs_trigger_check;

alter table public.pipeline_runs
  add constraint pipeline_runs_trigger_check
  check (trigger in (
    'manual',
    'scheduled',
    'schedule',
    'onboarding',
    'managed_agent',
    'remote'
  ));
