-- Allow a user to keep separate GitHub App and GitHub OAuth connections for the same account.

alter table public.github_connections
  drop constraint if exists github_connections_owner_user_id_account_login_key;

create unique index if not exists idx_github_connections_owner_provider_account
  on public.github_connections(owner_user_id, provider, account_login);

notify pgrst, 'reload schema';
