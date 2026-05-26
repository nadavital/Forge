-- Add hosted Supabase row-level access policies for Forge's user/workspace scope.
-- The dashboard still uses service-role credentials server-side today, but these
-- policies make the schema ready for authenticated browser/realtime access.

create or replace function public.forge_current_user_id()
returns text
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')
$$;

create or replace function public.forge_can_access_workspace(target_workspace_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members
    where workspace_id = target_workspace_id
      and user_id = public.forge_current_user_id()
  )
$$;

create or replace function public.forge_can_access_project(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.projects
    where id = target_project_id
      and (
        owner_user_id = public.forge_current_user_id()
        or (
          workspace_id is not null
          and public.forge_can_access_workspace(workspace_id)
        )
      )
  )
$$;

alter table public.users enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.projects enable row level security;
alter table public.github_connections enable row level security;
alter table public.source_configs enable row level security;
alter table public.triggers enable row level security;
alter table public.user_preferences enable row level security;
alter table public.preference_events enable row level security;
alter table public.pipeline_runs enable row level security;
alter table public.signals enable row level security;
alter table public.opportunities enable row level security;
alter table public.opportunity_signals enable row level security;
alter table public.opportunity_evaluations enable row level security;
alter table public.prototype_options enable row level security;
alter table public.mvp_builds enable row level security;
alter table public.build_artifacts enable row level security;
alter table public.reflection_runs enable row level security;
alter table public.reflection_proposals enable row level security;
alter table public.idea_conversations enable row level security;
alter table public.idea_messages enable row level security;
alter table public.research_briefs enable row level security;
alter table public.agent_tasks enable row level security;
alter table public.project_schedules enable row level security;
alter table public.project_source_configs enable row level security;
alter table public.project_runs enable row level security;
alter table public.opportunity_actions enable row level security;

drop policy if exists forge_users_self on public.users;
create policy forge_users_self on public.users
  for all
  using (id = public.forge_current_user_id())
  with check (id = public.forge_current_user_id());

drop policy if exists forge_workspaces_member_access on public.workspaces;
create policy forge_workspaces_member_access on public.workspaces
  for all
  using (public.forge_can_access_workspace(id))
  with check (owner_user_id = public.forge_current_user_id() or public.forge_can_access_workspace(id));

drop policy if exists forge_workspace_members_member_access on public.workspace_members;
create policy forge_workspace_members_member_access on public.workspace_members
  for all
  using (public.forge_can_access_workspace(workspace_id))
  with check (public.forge_can_access_workspace(workspace_id));

drop policy if exists forge_projects_workspace_access on public.projects;
create policy forge_projects_workspace_access on public.projects
  for all
  using (public.forge_can_access_project(id))
  with check (
    owner_user_id = public.forge_current_user_id()
    or (
      workspace_id is not null
      and public.forge_can_access_workspace(workspace_id)
    )
  );

drop policy if exists forge_github_connections_workspace_access on public.github_connections;
create policy forge_github_connections_workspace_access on public.github_connections
  for all
  using (
    owner_user_id = public.forge_current_user_id()
    or (
      workspace_id is not null
      and public.forge_can_access_workspace(workspace_id)
    )
  )
  with check (
    owner_user_id = public.forge_current_user_id()
    or (
      workspace_id is not null
      and public.forge_can_access_workspace(workspace_id)
    )
  );

drop policy if exists forge_source_configs_project_access on public.source_configs;
create policy forge_source_configs_project_access on public.source_configs
  for all using (public.forge_can_access_project(project_id))
  with check (public.forge_can_access_project(project_id));

drop policy if exists forge_triggers_project_access on public.triggers;
create policy forge_triggers_project_access on public.triggers
  for all using (public.forge_can_access_project(project_id))
  with check (public.forge_can_access_project(project_id));

drop policy if exists forge_user_preferences_project_access on public.user_preferences;
create policy forge_user_preferences_project_access on public.user_preferences
  for all using (public.forge_can_access_project(project_id))
  with check (public.forge_can_access_project(project_id));

drop policy if exists forge_preference_events_project_access on public.preference_events;
create policy forge_preference_events_project_access on public.preference_events
  for all using (public.forge_can_access_project(project_id))
  with check (public.forge_can_access_project(project_id));

drop policy if exists forge_pipeline_runs_project_access on public.pipeline_runs;
create policy forge_pipeline_runs_project_access on public.pipeline_runs
  for all using (project_id is not null and public.forge_can_access_project(project_id))
  with check (project_id is not null and public.forge_can_access_project(project_id));

drop policy if exists forge_signals_project_access on public.signals;
create policy forge_signals_project_access on public.signals
  for all using (project_id is not null and public.forge_can_access_project(project_id))
  with check (project_id is not null and public.forge_can_access_project(project_id));

drop policy if exists forge_opportunities_project_access on public.opportunities;
create policy forge_opportunities_project_access on public.opportunities
  for all using (project_id is not null and public.forge_can_access_project(project_id))
  with check (project_id is not null and public.forge_can_access_project(project_id));

drop policy if exists forge_opportunity_signals_project_access on public.opportunity_signals;
create policy forge_opportunity_signals_project_access on public.opportunity_signals
  for all
  using (
    exists (
      select 1
      from public.opportunities opportunity
      where opportunity.id = opportunity_id
        and opportunity.project_id is not null
        and public.forge_can_access_project(opportunity.project_id)
    )
  )
  with check (
    exists (
      select 1
      from public.opportunities opportunity
      join public.signals signal on signal.id = signal_id
      where opportunity.id = opportunity_id
        and opportunity.project_id is not null
        and signal.project_id is not null
        and public.forge_can_access_project(opportunity.project_id)
        and public.forge_can_access_project(signal.project_id)
    )
  );

drop policy if exists forge_opportunity_evaluations_project_access on public.opportunity_evaluations;
create policy forge_opportunity_evaluations_project_access on public.opportunity_evaluations
  for all
  using (
    exists (
      select 1
      from public.opportunities opportunity
      where opportunity.id = opportunity_id
        and opportunity.project_id is not null
        and public.forge_can_access_project(opportunity.project_id)
    )
  )
  with check (
    exists (
      select 1
      from public.opportunities opportunity
      where opportunity.id = opportunity_id
        and opportunity.project_id is not null
        and public.forge_can_access_project(opportunity.project_id)
    )
  );

drop policy if exists forge_prototype_options_project_access on public.prototype_options;
create policy forge_prototype_options_project_access on public.prototype_options
  for all using (public.forge_can_access_project(project_id))
  with check (public.forge_can_access_project(project_id));

drop policy if exists forge_mvp_builds_project_access on public.mvp_builds;
create policy forge_mvp_builds_project_access on public.mvp_builds
  for all using (project_id is not null and public.forge_can_access_project(project_id))
  with check (project_id is not null and public.forge_can_access_project(project_id));

drop policy if exists forge_build_artifacts_project_access on public.build_artifacts;
create policy forge_build_artifacts_project_access on public.build_artifacts
  for all
  using (
    exists (
      select 1
      from public.mvp_builds build
      where build.id = mvp_build_id
        and build.project_id is not null
        and public.forge_can_access_project(build.project_id)
    )
  )
  with check (
    exists (
      select 1
      from public.mvp_builds build
      where build.id = mvp_build_id
        and build.project_id is not null
        and public.forge_can_access_project(build.project_id)
    )
  );

drop policy if exists forge_reflection_runs_project_access on public.reflection_runs;
create policy forge_reflection_runs_project_access on public.reflection_runs
  for all using (public.forge_can_access_project(project_id))
  with check (public.forge_can_access_project(project_id));

drop policy if exists forge_reflection_proposals_project_access on public.reflection_proposals;
create policy forge_reflection_proposals_project_access on public.reflection_proposals
  for all
  using (
    exists (
      select 1
      from public.reflection_runs run
      where run.id = reflection_run_id
        and public.forge_can_access_project(run.project_id)
    )
  )
  with check (
    exists (
      select 1
      from public.reflection_runs run
      where run.id = reflection_run_id
        and public.forge_can_access_project(run.project_id)
    )
  );

drop policy if exists forge_idea_conversations_project_access on public.idea_conversations;
create policy forge_idea_conversations_project_access on public.idea_conversations
  for all using (public.forge_can_access_project(project_id))
  with check (public.forge_can_access_project(project_id));

drop policy if exists forge_idea_messages_project_access on public.idea_messages;
create policy forge_idea_messages_project_access on public.idea_messages
  for all
  using (
    exists (
      select 1
      from public.idea_conversations conversation
      where conversation.id = conversation_id
        and public.forge_can_access_project(conversation.project_id)
    )
  )
  with check (
    exists (
      select 1
      from public.idea_conversations conversation
      where conversation.id = conversation_id
        and public.forge_can_access_project(conversation.project_id)
    )
  );

drop policy if exists forge_research_briefs_project_access on public.research_briefs;
create policy forge_research_briefs_project_access on public.research_briefs
  for all using (public.forge_can_access_project(project_id))
  with check (public.forge_can_access_project(project_id));

drop policy if exists forge_agent_tasks_project_access on public.agent_tasks;
create policy forge_agent_tasks_project_access on public.agent_tasks
  for all using (public.forge_can_access_project(project_id))
  with check (public.forge_can_access_project(project_id));

drop policy if exists forge_project_schedules_project_access on public.project_schedules;
create policy forge_project_schedules_project_access on public.project_schedules
  for all using (public.forge_can_access_project(project_id))
  with check (public.forge_can_access_project(project_id));

drop policy if exists forge_project_source_configs_project_access on public.project_source_configs;
create policy forge_project_source_configs_project_access on public.project_source_configs
  for all using (public.forge_can_access_project(project_id))
  with check (public.forge_can_access_project(project_id));

drop policy if exists forge_project_runs_project_access on public.project_runs;
create policy forge_project_runs_project_access on public.project_runs
  for all using (public.forge_can_access_project(project_id))
  with check (public.forge_can_access_project(project_id));

drop policy if exists forge_opportunity_actions_project_access on public.opportunity_actions;
create policy forge_opportunity_actions_project_access on public.opportunity_actions
  for all using (project_id is not null and public.forge_can_access_project(project_id))
  with check (project_id is not null and public.forge_can_access_project(project_id));

notify pgrst, 'reload schema';
