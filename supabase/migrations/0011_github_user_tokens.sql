-- Store GitHub App user access tokens server-side for OAuth-backed user-account operations.

create table if not exists public.github_user_tokens (
  id text primary key,
  connection_id text not null references public.github_connections(id) on delete cascade,
  owner_user_id text not null references public.users(id) on delete cascade,
  access_token text not null,
  token_type text,
  expires_at timestamptz,
  refresh_token text,
  refresh_token_expires_at timestamptz,
  scopes text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(connection_id)
);

create index if not exists idx_github_user_tokens_owner
  on public.github_user_tokens(owner_user_id);

alter table public.github_user_tokens enable row level security;

drop policy if exists forge_github_user_tokens_owner_access on public.github_user_tokens;
create policy forge_github_user_tokens_owner_access on public.github_user_tokens
  for all
  using (owner_user_id = public.forge_current_user_id())
  with check (owner_user_id = public.forge_current_user_id());

notify pgrst, 'reload schema';
