-- Project onboarding and repository connection contract.

alter table public.projects
  add column if not exists product_url text,
  add column if not exists archived_at timestamptz;

alter table public.projects
  drop constraint if exists projects_mode_check;

alter table public.projects
  add constraint projects_mode_check
  check (mode in ('connected_product', 'new_product'));

alter table public.projects
  alter column description drop not null;

alter table public.projects
  alter column description set default '';

create index if not exists idx_projects_archived_at
  on public.projects(archived_at);
