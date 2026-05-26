-- Baseline product-discovery tables used by later dashboard migrations.
-- Later migrations extend these contracts for onboarding, runtime status,
-- identity scope, GitHub connections, and AI-led research briefs.

create extension if not exists pgcrypto;

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  mode text not null check (mode in ('connected_product', 'new_product', 'new_project', 'existing_project')),
  repo_url text,
  description text not null default '',
  product_context text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pipeline_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete set null,
  run_type text not null default 'managed',
  status text not null default 'queued',
  trigger text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  error text,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.signals (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete set null,
  source_config_id uuid,
  source text,
  source_id text,
  url text,
  title text,
  body text,
  author text,
  published_at timestamptz,
  captured_at timestamptz not null default now(),
  tags text[] not null default '{}'::text[],
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.opportunities (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete set null,
  pipeline_run_id uuid references public.pipeline_runs(id) on delete set null,
  title text,
  problem text,
  target_user text,
  mvp_concept text,
  score numeric,
  score_rationale text,
  status text not null default 'proposed',
  profile jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.opportunity_signals (
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  signal_id uuid not null references public.signals(id) on delete cascade,
  primary key (opportunity_id, signal_id)
);

create table if not exists public.opportunity_evaluations (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid references public.opportunities(id) on delete cascade,
  evaluator text,
  content text,
  scores jsonb not null default '{}'::jsonb
);

create index if not exists idx_pipeline_runs_project_started
  on public.pipeline_runs(project_id, started_at desc);

create index if not exists idx_signals_project_captured
  on public.signals(project_id, captured_at desc);

create index if not exists idx_opportunities_project_score
  on public.opportunities(project_id, score desc, created_at desc);

create index if not exists idx_opportunity_evaluations_opportunity
  on public.opportunity_evaluations(opportunity_id);

notify pgrst, 'reload schema';
