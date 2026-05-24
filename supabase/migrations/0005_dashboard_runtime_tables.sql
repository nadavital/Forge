-- Align hosted Supabase with the dashboard runtime table contract.
-- Earlier migrations used project_* table names and an older mvp_builds shape,
-- while the dashboard repository reads and writes the tables below directly.

create extension if not exists pgcrypto;

alter table public.projects
  add column if not exists stage text,
  add column if not exists product_url text,
  add column if not exists archived_at timestamptz;

alter table public.projects
  drop constraint if exists projects_mode_check;

alter table public.projects
  add constraint projects_mode_check
  check (mode in ('connected_product', 'new_product', 'new_project', 'existing_project'));

alter table public.projects
  alter column description drop not null;

alter table public.projects
  alter column description set default '';

create table if not exists public.source_configs (
  id text primary key,
  project_id uuid references public.projects(id) on delete cascade,
  source_type text not null,
  name text not null default '',
  status text not null default 'active',
  config jsonb not null default '{}'::jsonb
);

create table if not exists public.triggers (
  id text primary key,
  project_id uuid references public.projects(id) on delete cascade,
  name text not null default '',
  trigger_type text not null default 'manual',
  status text not null default 'active',
  last_run_at timestamptz,
  config jsonb not null default '{}'::jsonb
);

create table if not exists public.user_preferences (
  id text primary key,
  project_id uuid references public.projects(id) on delete cascade,
  preferred_markets text[] not null default '{}'::text[],
  preferred_buyers text[] not null default '{}'::text[],
  risk_tolerance text,
  notes text,
  updated_at timestamptz not null default now()
);

create table if not exists public.preference_events (
  id text primary key,
  project_id uuid references public.projects(id) on delete cascade,
  user_preference_id text references public.user_preferences(id) on delete set null,
  event_type text not null,
  opportunity_id uuid references public.opportunities(id) on delete set null,
  mvp_build_id uuid,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.prototype_options (
  id text primary key,
  project_id uuid references public.projects(id) on delete cascade,
  opportunity_id uuid references public.opportunities(id) on delete cascade,
  title text,
  prototype_type text,
  summary text,
  status text,
  artifact_url text,
  artifact_payload jsonb not null default '{}'::jsonb
);

alter table public.mvp_builds
  add column if not exists generated_repo_url text,
  add column if not exists branch text,
  add column if not exists logs text,
  add column if not exists build_brief jsonb,
  add column if not exists template_repo_url text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.mvp_builds
  alter column project_id drop not null,
  alter column opportunity_id drop not null,
  alter column repo_url drop not null,
  alter column stage drop not null;

alter table public.mvp_builds
  drop constraint if exists mvp_builds_status_check;

alter table public.mvp_builds
  add constraint mvp_builds_status_check
  check (status in ('queued', 'briefed', 'blocked', 'reviewing', 'completed', 'failed', 'in_progress'));

create table if not exists public.build_artifacts (
  id text primary key,
  mvp_build_id uuid references public.mvp_builds(id) on delete cascade,
  artifact_type text not null,
  content text,
  url text,
  metadata jsonb
);

create table if not exists public.reflection_runs (
  id text primary key,
  project_id uuid references public.projects(id) on delete cascade,
  status text not null,
  summary text,
  evidence jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.reflection_proposals (
  id text primary key,
  reflection_run_id text references public.reflection_runs(id) on delete cascade,
  proposal_type text not null,
  risk_level text not null,
  title text not null,
  rationale text,
  patch jsonb not null default '{}'::jsonb,
  status text not null default 'proposed',
  updated_at timestamptz
);

create index if not exists idx_source_configs_project
  on public.source_configs(project_id);

create index if not exists idx_triggers_project
  on public.triggers(project_id);

create index if not exists idx_user_preferences_project
  on public.user_preferences(project_id);

create index if not exists idx_preference_events_project_created
  on public.preference_events(project_id, created_at desc);

create index if not exists idx_prototype_options_project
  on public.prototype_options(project_id);

create index if not exists idx_build_artifacts_mvp_build
  on public.build_artifacts(mvp_build_id);

create index if not exists idx_reflection_runs_project_created
  on public.reflection_runs(project_id, created_at desc);
