-- Ensure OAuth token rows cannot point at another user's GitHub connection.

drop policy if exists forge_github_user_tokens_owner_access on public.github_user_tokens;
create policy forge_github_user_tokens_owner_access on public.github_user_tokens
  for all
  using (
    owner_user_id = public.forge_current_user_id()
    and exists (
      select 1
      from public.github_connections connection
      where connection.id = connection_id
        and connection.owner_user_id = public.forge_current_user_id()
    )
  )
  with check (
    owner_user_id = public.forge_current_user_id()
    and exists (
      select 1
      from public.github_connections connection
      where connection.id = connection_id
        and connection.owner_user_id = public.forge_current_user_id()
    )
  );

notify pgrst, 'reload schema';
