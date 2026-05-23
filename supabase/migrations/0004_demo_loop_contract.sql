-- Demo loop contract hardening for preference learning, prototypes, reflection, and build review.

alter table if exists public.prototype_options
  add column if not exists prototype_type text,
  add column if not exists summary text,
  add column if not exists artifact_payload jsonb not null default '{}'::jsonb;

alter table if exists public.reflection_proposals
  add column if not exists patch jsonb not null default '{}'::jsonb;

create index if not exists idx_preference_events_project_created
  on public.preference_events(project_id, created_at desc);

create index if not exists idx_prototype_options_project_created
  on public.prototype_options(project_id, created_at desc);

create index if not exists idx_reflection_runs_project_created
  on public.reflection_runs(project_id, created_at desc);
