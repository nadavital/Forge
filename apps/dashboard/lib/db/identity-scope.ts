export type ActiveIdentity = {
  userId: string;
  workspaceId: string;
  authProvider?: "local" | "supabase";
  authSubject?: string;
  email?: string | null;
};

export type ScopedProject = {
  owner_user_id?: string | null;
  workspace_id?: string | null;
};

export type ScopedGitHubConnection = {
  id: string;
  owner_user_id?: string | null;
  workspace_id?: string | null;
};

export type ProjectSourceConnection = {
  project_id: string;
  connection_id?: string | null;
};

export type ScopedOpportunity = {
  project_id?: string | null;
};

export type ScopedConversation = {
  project_id?: string | null;
};

export type ScopedResearchBrief = {
  project_id?: string | null;
};

export type ScopedProjectChild = {
  project_id?: string | null;
};

export function projectVisibleToIdentity(project: ScopedProject, identity: ActiveIdentity): boolean {
  if (project.workspace_id) {
    return project.workspace_id === identity.workspaceId;
  }
  if (project.owner_user_id) {
    return project.owner_user_id === identity.userId;
  }
  return true;
}

export function visibleProjectIdsForIdentity<T extends ScopedProject & { id: string }>(
  projects: T[],
  identity: ActiveIdentity
): Set<string> {
  return new Set(projects.filter((project) => projectVisibleToIdentity(project, identity)).map((project) => project.id));
}

export function githubConnectionVisibleToProject(input: {
  projectId: string;
  project?: ScopedProject | null;
  connection: ScopedGitHubConnection;
  sources: ProjectSourceConnection[];
}): boolean {
  if (input.project?.workspace_id && input.connection.workspace_id === input.project.workspace_id) {
    return true;
  }
  return input.sources.some(
    (source) => source.project_id === input.projectId && source.connection_id === input.connection.id
  );
}

export function githubConnectionUsableForProject(input: {
  projectId: string;
  project?: ScopedProject | null;
  identity: ActiveIdentity;
  connection?: ScopedGitHubConnection | null;
  sources: ProjectSourceConnection[];
}): boolean {
  if (!input.project || !input.connection || !projectVisibleToIdentity(input.project, input.identity)) {
    return false;
  }
  if (input.project.workspace_id && input.connection.workspace_id === input.project.workspace_id) {
    return true;
  }
  if (input.connection.owner_user_id && input.connection.owner_user_id === input.identity.userId) {
    return true;
  }
  return githubConnectionVisibleToProject({
    projectId: input.projectId,
    project: input.project,
    connection: input.connection,
    sources: input.sources
  });
}

export function opportunityBelongsToProject(
  opportunity: ScopedOpportunity | undefined | null,
  projectId: string
): boolean {
  return Boolean(opportunity?.project_id && opportunity.project_id === projectId);
}

export function conversationBelongsToProject(
  conversation: ScopedConversation | undefined | null,
  projectId: string
): boolean {
  return Boolean(conversation?.project_id && conversation.project_id === projectId);
}

export function researchBriefBelongsToProject(
  brief: ScopedResearchBrief | undefined | null,
  projectId: string
): boolean {
  return Boolean(brief?.project_id && brief.project_id === projectId);
}

export function projectChildBelongsToProject(
  child: ScopedProjectChild | undefined | null,
  projectId: string
): boolean {
  return Boolean(child?.project_id && child.project_id === projectId);
}
