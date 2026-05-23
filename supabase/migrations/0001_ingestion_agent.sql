create extension if not exists "pgcrypto";

create table if not exists pipeline_runs (
    id uuid primary key default gen_random_uuid(),
    run_type text not null check (run_type in ('ranking', 'build', 'fixture', 'managed')),
    status text not null check (status in ('pending', 'running', 'completed', 'failed')),
    trigger text not null check (trigger in ('manual', 'schedule', 'fixture', 'remote', 'managed_agent')),
    started_at timestamptz not null default now(),
    completed_at timestamptz,
    error text,
    metadata jsonb not null default '{}'::jsonb
);

create table if not exists signals (
    id uuid primary key default gen_random_uuid(),
    source text not null,
    source_id text,
    url text,
    title text not null,
    body text not null default '',
    author text,
    published_at timestamptz,
    captured_at timestamptz not null default now(),
    tags text[] not null default '{}',
    metadata jsonb not null default '{}'::jsonb
);

create table if not exists opportunities (
    id uuid primary key default gen_random_uuid(),
    pipeline_run_id uuid references pipeline_runs(id) on delete set null,
    title text not null,
    problem text not null,
    target_user text not null,
    mvp_concept text not null,
    score numeric,
    score_rationale text not null default '',
    status text not null default 'proposed' check (
        status in ('proposed', 'approved', 'rejected', 'building', 'built', 'archived')
    ),
    profile jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists opportunity_signals (
    opportunity_id uuid not null references opportunities(id) on delete cascade,
    signal_id uuid not null references signals(id) on delete cascade,
    relevance numeric,
    notes text,
    primary key (opportunity_id, signal_id)
);

create table if not exists opportunity_evaluations (
    id uuid primary key default gen_random_uuid(),
    opportunity_id uuid not null references opportunities(id) on delete cascade,
    evaluator text not null,
    content text not null,
    scores jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create index if not exists pipeline_runs_run_type_status_started_at_idx
    on pipeline_runs(run_type, status, started_at desc);

create index if not exists signals_source_published_at_idx
    on signals(source, published_at desc);

create index if not exists signals_source_source_id_idx
    on signals(source, source_id)
    where source_id is not null;

create index if not exists signals_url_idx
    on signals(url)
    where url is not null;

create index if not exists opportunities_status_score_created_at_idx
    on opportunities(status, score desc, created_at desc);

create index if not exists opportunity_evaluations_opportunity_id_created_at_idx
    on opportunity_evaluations(opportunity_id, created_at desc);

do $$
begin
    alter publication supabase_realtime add table opportunities;
exception
    when duplicate_object then null;
    when undefined_object then null;
end $$;
