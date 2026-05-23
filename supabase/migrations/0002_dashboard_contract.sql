-- Dashboard/API contract tables for the hackathon Forge app.

create extension if not exists pgcrypto;

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  mode text not null check (mode in ('new_project', 'existing_project')),
  repo_url text,
  description text not null default '',
  product_context text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_schedules (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  enabled boolean not null default true,
  cron text not null default '0 8 * * 1-5',
  timezone text not null default 'America/Los_Angeles',
  next_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id)
);

create table if not exists public.project_source_configs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  source_type text not null,
  config jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  status text not null check (status in ('queued', 'in_progress', 'completed', 'failed')),
  stage text not null check (stage in (
    'project_analysis',
    'signal_collection',
    'opportunity_clustering',
    'bull_bear',
    'synthesis',
    'ready',
    'failed'
  )),
  trigger text not null check (trigger in ('manual', 'scheduled', 'onboarding')),
  summary text,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.opportunity_actions (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  action text not null check (action in ('watch', 'reject', 'research_more', 'approve_for_build')),
  user_notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.mvp_builds (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  status text not null check (status in ('in_progress', 'completed', 'failed')),
  stage text not null check (stage in ('starting_managed_builder', 'building', 'opening_pr', 'completed', 'failed')),
  repo_url text not null,
  branch_name text,
  pr_url text,
  preview_url text,
  summary text,
  error text,
  build_type text not null default 'prototype_pr',
  user_notes text,
  prompt_context jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.pipeline_runs
  add column if not exists project_id uuid references public.projects(id) on delete set null;

alter table public.signals
  add column if not exists project_id uuid references public.projects(id) on delete set null;

alter table public.opportunities
  add column if not exists project_id uuid references public.projects(id) on delete set null;

create index if not exists idx_project_runs_project_started
  on public.project_runs(project_id, started_at desc);

create index if not exists idx_opportunities_project_score
  on public.opportunities(project_id, score desc);

create index if not exists idx_mvp_builds_project_started
  on public.mvp_builds(project_id, started_at desc);

create index if not exists idx_opportunity_actions_opportunity_created
  on public.opportunity_actions(opportunity_id, created_at desc);
