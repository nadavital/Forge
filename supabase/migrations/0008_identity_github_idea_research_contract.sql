-- Add ownership, GitHub connection, AI idea intake, research brief, and agent task contracts.

create table if not exists public.users (
  id text primary key,
  email text,
  display_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.workspaces (
  id text primary key,
  name text not null,
  owner_user_id text not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id text not null references public.workspaces(id) on delete cascade,
  user_id text not null references public.users(id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

alter table public.projects
  add column if not exists owner_user_id text references public.users(id) on delete set null,
  add column if not exists workspace_id text references public.workspaces(id) on delete set null;

create table if not exists public.github_connections (
  id text primary key,
  owner_user_id text not null references public.users(id) on delete cascade,
  workspace_id text references public.workspaces(id) on delete cascade,
  provider text not null check (provider in ('github_app', 'github_oauth')),
  account_login text not null,
  account_type text check (account_type in ('User', 'Organization')),
  installation_id text,
  scopes text[] not null default '{}'::text[],
  status text not null check (status in ('active', 'revoked', 'needs_reauth')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_user_id, account_login)
);

alter table public.source_configs
  add column if not exists connection_id text references public.github_connections(id) on delete set null;

create table if not exists public.idea_conversations (
  id text primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id text references public.users(id) on delete set null,
  title text not null,
  status text not null check (status in ('active', 'brief_ready', 'researching', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.idea_messages (
  id text primary key,
  conversation_id text not null references public.idea_conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.research_briefs (
  id text primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  conversation_id text references public.idea_conversations(id) on delete set null,
  status text not null check (status in ('needs_context', 'ready_for_research', 'approved', 'running', 'completed')),
  hypothesis text not null,
  target_users text[] not null default '{}'::text[],
  pain_area text not null default '',
  constraints text[] not null default '{}'::text[],
  source_plan text[] not null default '{}'::text[],
  disqualifying_evidence text[] not null default '{}'::text[],
  mvp_boundaries text[] not null default '{}'::text[],
  user_taste_notes text[] not null default '{}'::text[],
  open_questions text[] not null default '{}'::text[],
  confidence numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.pipeline_runs
  add column if not exists research_brief_id text references public.research_briefs(id) on delete set null;

create table if not exists public.agent_tasks (
  id text primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  pipeline_run_id uuid references public.pipeline_runs(id) on delete set null,
  research_brief_id text references public.research_briefs(id) on delete set null,
  agent_role text not null,
  status text not null check (status in ('queued', 'running', 'completed', 'failed')),
  prompt text,
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_projects_workspace
  on public.projects(workspace_id);

create index if not exists idx_github_connections_owner
  on public.github_connections(owner_user_id, status);

create index if not exists idx_idea_conversations_project
  on public.idea_conversations(project_id, updated_at desc);

create index if not exists idx_idea_messages_conversation
  on public.idea_messages(conversation_id, created_at);

create index if not exists idx_research_briefs_project
  on public.research_briefs(project_id, updated_at desc);

create index if not exists idx_agent_tasks_project
  on public.agent_tasks(project_id, created_at desc);

notify pgrst, 'reload schema';
