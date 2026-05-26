-- Map hosted auth subjects to stable Forge users before enabling browser/realtime access.
-- This keeps auth-provider ids separate from Forge's durable user ids.

create table if not exists public.user_auth_identities (
  id text primary key,
  user_id text not null references public.users(id) on delete cascade,
  provider text not null,
  subject text not null,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider, subject),
  unique(user_id, provider, subject)
);

create index if not exists idx_user_auth_identities_user
  on public.user_auth_identities(user_id);

create or replace function public.forge_current_auth_subject()
returns text
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')
$$;

create or replace function public.forge_current_user_id()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select identity.user_id
      from public.user_auth_identities identity
      where identity.provider = 'supabase'
        and identity.subject = public.forge_current_auth_subject()
      limit 1
    ),
    public.forge_current_auth_subject()
  )
$$;

alter table public.user_auth_identities enable row level security;

drop policy if exists forge_user_auth_identities_self on public.user_auth_identities;
create policy forge_user_auth_identities_self on public.user_auth_identities
  for all
  using (
    user_id = public.forge_current_user_id()
    or subject = public.forge_current_auth_subject()
  )
  with check (
    user_id = public.forge_current_user_id()
    or subject = public.forge_current_auth_subject()
  );

notify pgrst, 'reload schema';
