-- Publish project-scoped status tables to Supabase Realtime.
-- RLS policies from 0009/0010 still decide which authenticated JWT subjects can receive rows.

do $$
declare
  table_name text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;

  foreach table_name in array array[
    'pipeline_runs',
    'idea_conversations',
    'research_briefs',
    'agent_tasks',
    'opportunities',
    'prototype_options',
    'mvp_builds',
    'reflection_runs'
  ]
  loop
    if exists (
      select 1
      from pg_class table_class
      join pg_namespace namespace on namespace.oid = table_class.relnamespace
      where namespace.nspname = 'public'
        and table_class.relname = table_name
    ) and not exists (
      select 1
      from pg_publication_tables published
      where published.pubname = 'supabase_realtime'
        and published.schemaname = 'public'
        and published.tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end $$;
