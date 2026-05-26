import { AsyncLocalStorage } from "node:async_hooks";
import { newId, readLocalStore, writeLocalStore } from "@/lib/db/local-db";
import {
  type ActiveIdentity,
  conversationBelongsToProject,
  githubConnectionUsableForProject,
  githubConnectionVisibleToProject,
  opportunityBelongsToProject,
  projectChildBelongsToProject,
  projectVisibleToIdentity,
  researchBriefBelongsToProject
} from "@/lib/db/identity-scope";
import { getRequestAuthContext } from "@/lib/auth/request-session";
import { GENERATED_REPO_TARGET_SOURCE_TYPE, generatedRepoTargetSource } from "@/lib/build/github-target";
import { conversationStatusForResearchBriefStatus } from "@/lib/ideas/research-brief-approval";
import { opportunityStatusForPreferenceEvent } from "@/lib/preference-event-status";
import { createPrototypeOptionDraft } from "@/lib/prototypes/prototype-options";
import { createSupabaseClient, isSupabaseConfigured } from "@/lib/db/supabase";
import { isHostedAuthRequired } from "@/lib/auth/supabase-auth";
import {
  buildProjectDefaults,
  githubSourcePatch,
  normalizeGithubRepository,
  sourceStatusForSettings
} from "@/lib/project-onboarding";
import { decryptSecretFromStorage, encryptSecretForStorage } from "@/lib/security/secret-storage";
import type {
  DbBuildArtifact,
  DbEvaluation,
  DbAgentTask,
  DbGitHubConnection,
  DbGitHubUserToken,
  DbIdeaConversation,
  DbIdeaMessage,
  DbMvpBuild,
  DbOpportunity,
  DbOpportunitySignal,
  DbPipelineRun,
  DbPreferenceEvent,
  DbProject,
  DbResearchBrief,
  DbReflectionRun,
  DbReflectionProposal,
  DbSignal,
  DbSourceConfig,
  DbPrototype,
  DbTrigger,
  DbUser,
  DbUserAuthIdentity,
  DbUserPreference,
  DbWorkspace,
  DbWorkspaceMember,
  ForgeDbBackend,
  ForgeStore,
  JsonObject
} from "@/lib/db/types";
import type { ProjectMode } from "@/types/forge";

type SupabaseRepositoryClient = NonNullable<ReturnType<typeof createSupabaseClient>>;
const activeIdentityScope = new AsyncLocalStorage<ActiveIdentity>();

export function getDbBackend(): ForgeDbBackend {
  return isSupabaseConfigured() ? "supabase" : "local";
}

export async function loadStore(): Promise<ForgeStore> {
  const supabase = createSupabaseClient();
  if (!supabase) {
    return readLocalStore();
  }

  return loadSupabaseScopedStore(supabase);
}

async function loadSupabaseScopedStore(
  supabase: SupabaseRepositoryClient
): Promise<ForgeStore> {
  const identity = await getActiveIdentity();
  const projects = await selectVisibleProjects(supabase, identity);
  const projectIds = projects.map((project) => project.id);

  const [
    users,
    workspaces,
    workspaceMembers,
    authIdentities,
    sourceConfigs,
    triggers,
    userPreferences,
    preferenceEvents,
    pipelineRuns,
    ideaConversations,
    researchBriefs,
    agentTasks,
    signals,
    opportunities,
    prototypeOptions,
    mvpBuilds,
    reflectionRuns
  ] = await Promise.all([
    safeSelect<DbUser>(supabase, "users", `select=*&id=eq.${encodeURIComponent(identity.userId)}`),
    safeSelect<DbWorkspace>(supabase, "workspaces", `select=*&id=eq.${encodeURIComponent(identity.workspaceId)}`),
    safeSelect<DbWorkspaceMember>(
      supabase,
      "workspace_members",
      `select=*&workspace_id=eq.${encodeURIComponent(identity.workspaceId)}`
    ),
    safeSelect<DbUserAuthIdentity>(
      supabase,
      "user_auth_identities",
      `select=*&user_id=eq.${encodeURIComponent(identity.userId)}`
    ),
    selectProjectRows<DbSourceConfig>(supabase, "source_configs", projectIds),
    selectProjectRows<DbTrigger>(supabase, "triggers", projectIds),
    selectProjectRows<DbUserPreference>(supabase, "user_preferences", projectIds),
    selectProjectRows<DbPreferenceEvent>(supabase, "preference_events", projectIds),
    selectProjectRows<DbPipelineRun>(supabase, "pipeline_runs", projectIds),
    selectProjectRows<DbIdeaConversation>(supabase, "idea_conversations", projectIds),
    selectProjectRows<DbResearchBrief>(supabase, "research_briefs", projectIds),
    selectProjectRows<DbAgentTask>(supabase, "agent_tasks", projectIds),
    selectProjectRows<DbSignal>(supabase, "signals", projectIds),
    selectProjectRows<DbOpportunity>(supabase, "opportunities", projectIds),
    selectProjectRows<DbPrototype>(supabase, "prototype_options", projectIds),
    selectProjectRows<DbMvpBuild>(supabase, "mvp_builds", projectIds),
    selectProjectRows<DbReflectionRun>(supabase, "reflection_runs", projectIds)
  ]);

  const [ideaMessages, opportunitySignals, opportunityEvaluations, buildArtifacts, reflectionProposals, githubConnections] =
    await Promise.all([
      selectRowsByIds<DbIdeaMessage>(
        supabase,
        "idea_messages",
        "conversation_id",
        ideaConversations.map((conversation) => conversation.id)
      ),
      selectRowsByIds<DbOpportunitySignal>(
        supabase,
        "opportunity_signals",
        "opportunity_id",
        opportunities.map((opportunity) => opportunity.id)
      ),
      selectRowsByIds<DbEvaluation>(
        supabase,
        "opportunity_evaluations",
        "opportunity_id",
        opportunities.map((opportunity) => opportunity.id)
      ),
      selectRowsByIds<DbBuildArtifact>(
        supabase,
        "build_artifacts",
        "mvp_build_id",
        mvpBuilds.map((build) => build.id)
      ),
      selectRowsByIds<DbReflectionProposal>(
        supabase,
        "reflection_proposals",
        "reflection_run_id",
        reflectionRuns.map((run) => run.id)
      ),
      selectVisibleGitHubConnections(supabase, identity, sourceConfigs)
    ]);

  return {
    users,
    workspaces,
    workspace_members: workspaceMembers,
    user_auth_identities: authIdentities,
    projects,
    github_connections: githubConnections,
    github_user_tokens: [],
    source_configs: sourceConfigs,
    triggers,
    user_preferences: userPreferences,
    preference_events: preferenceEvents,
    pipeline_runs: pipelineRuns,
    idea_conversations: ideaConversations,
    idea_messages: ideaMessages,
    research_briefs: researchBriefs,
    agent_tasks: agentTasks,
    signals,
    opportunities,
    opportunity_signals: opportunitySignals,
    opportunity_evaluations: opportunityEvaluations,
    prototype_options: prototypeOptions,
    mvp_builds: mvpBuilds,
    build_artifacts: buildArtifacts,
    reflection_runs: reflectionRuns,
    reflection_proposals: reflectionProposals
  };
}

async function selectVisibleProjects(
  supabase: SupabaseRepositoryClient,
  identity: { userId: string; workspaceId: string }
): Promise<DbProject[]> {
  const rows = await Promise.all([
    safeSelect<DbProject>(
      supabase,
      "projects",
      `select=*&owner_user_id=eq.${encodeURIComponent(identity.userId)}`
    ),
    safeSelect<DbProject>(
      supabase,
      "projects",
      `select=*&workspace_id=eq.${encodeURIComponent(identity.workspaceId)}`
    )
  ]);
  return uniqueById(rows.flat());
}

async function selectProjectRows<T>(
  supabase: SupabaseRepositoryClient,
  table: keyof ForgeStore,
  projectIds: string[]
): Promise<T[]> {
  return selectRowsByIds<T>(supabase, table, "project_id", projectIds);
}

async function selectRowsByIds<T>(
  supabase: SupabaseRepositoryClient,
  table: keyof ForgeStore,
  column: string,
  ids: string[]
): Promise<T[]> {
  const uniqueIds = uniqueStrings(ids);
  if (uniqueIds.length === 0) return [];
  return safeSelect<T>(supabase, table, `select=*&${column}=in.(${uniqueIds.map(encodeURIComponent).join(",")})`);
}

async function selectVisibleGitHubConnections(
  supabase: SupabaseRepositoryClient,
  identity: { userId: string; workspaceId: string },
  sources: DbSourceConfig[]
): Promise<DbGitHubConnection[]> {
  const sourceConnectionIds = sources
    .map((source) => source.connection_id)
    .filter((value): value is string => Boolean(value));
  const rows = await Promise.all([
    safeSelect<DbGitHubConnection>(
      supabase,
      "github_connections",
      `select=*&owner_user_id=eq.${encodeURIComponent(identity.userId)}`
    ),
    safeSelect<DbGitHubConnection>(
      supabase,
      "github_connections",
      `select=*&workspace_id=eq.${encodeURIComponent(identity.workspaceId)}`
    ),
    selectRowsByIds<DbGitHubConnection>(supabase, "github_connections", "id", sourceConnectionIds)
  ]);
  return uniqueById(rows.flat());
}

async function safeSelect<T>(
  supabase: SupabaseRepositoryClient,
  table: keyof ForgeStore,
  query: string
): Promise<T[]> {
  try {
    return await supabase.select<T>(table, query);
  } catch {
    return [];
  }
}

function uniqueById<T extends { id: string }>(rows: T[]): T[] {
  return [...new Map(rows.map((row) => [row.id, row])).values()];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

async function mutateStore(mutator: (store: ForgeStore) => void): Promise<ForgeStore> {
  if (isSupabaseConfigured()) {
    throw new Error("Direct store mutation is only supported on the local backend.");
  }

  const store = await readLocalStore();
  mutator(store);
  await writeLocalStore(store);
  return store;
}

export async function getActiveIdentity(): Promise<ActiveIdentity> {
  const scopedIdentity = activeIdentityScope.getStore();
  if (scopedIdentity) {
    return scopedIdentity;
  }

  const envUserId = cleanEnv(process.env.FORGE_USER_ID);
  const envWorkspaceId = cleanEnv(process.env.FORGE_WORKSPACE_ID);
  const requestAuth = await getRequestAuthContext();
  const authSubject = requestAuth?.subject ?? cleanEnv(process.env.FORGE_AUTH_SUBJECT);
  if (isSupabaseConfigured() && isHostedAuthRequired() && !requestAuth && !serverIdentityAllowedWhenAuthRequired()) {
    throw new Error(
      "Forge hosted auth is required for dashboard data access. Sign in through /login or set FORGE_ALLOW_SERVER_IDENTITY_WHEN_AUTH_REQUIRED=1 for trusted server jobs."
    );
  }

  if (isSupabaseConfigured() && authSubject && (!envUserId || !envWorkspaceId)) {
    const mapped = await resolveSupabaseAuthSubjectIdentity(authSubject, envWorkspaceId);
    if (mapped) {
      return {
        userId: envUserId ?? mapped.userId,
        workspaceId: envWorkspaceId ?? mapped.workspaceId,
        authProvider: requestAuth?.provider ?? "supabase",
        authSubject,
        email: requestAuth?.email ?? null
      };
    }
  }

  if (isSupabaseConfigured() && requestAuth) {
    return {
      userId: envUserId ?? requestAuth.subject,
      workspaceId: envWorkspaceId ?? `workspace_${requestAuth.subject}`,
      authProvider: requestAuth.provider,
      authSubject: requestAuth.subject,
      email: requestAuth.email ?? null
    };
  }

  return {
    userId: envUserId ?? "local-user",
    workspaceId: envWorkspaceId ?? "local-workspace",
    authProvider: isSupabaseConfigured() && authSubject ? "supabase" : "local",
    authSubject: authSubject ?? envUserId ?? "local-user",
    email: process.env.FORGE_USER_EMAIL || null
  };
}

export function withActiveIdentity<T>(identity: ActiveIdentity, callback: () => T): T {
  return activeIdentityScope.run(identity, callback);
}

export async function getProjectWorkerIdentity(projectId: string): Promise<ActiveIdentity> {
  const project = await getProjectWorkerScope(projectId);
  if (!project) {
    throw new Error("Project not found.");
  }
  return activeIdentityForProject(project);
}

export async function loadQueuedResearchPipelineRunsForWorker(input: {
  projectId?: string;
  limit: number;
}): Promise<Array<{ run: DbPipelineRun & { project_id: string }; identity: ActiveIdentity }>> {
  if (isSupabaseConfigured()) {
    const supabase = createSupabaseClient()!;
    const filters = [
      "select=*",
      "status=eq.queued",
      "research_brief_id=not.is.null",
      "project_id=not.is.null",
      "order=started_at.asc",
      `limit=${input.limit}`
    ];
    if (input.projectId) {
      filters.push(`project_id=eq.${encodeURIComponent(input.projectId)}`);
    }
    const runs = await supabase.select<DbPipelineRun>("pipeline_runs", filters.join("&"));
    return attachWorkerIdentities(runs);
  }

  const store = await readLocalStore();
  const candidates = store.pipeline_runs
    .filter((run) => run.status === "queued")
    .filter((run) => Boolean(run.research_brief_id))
    .filter((run) => Boolean(run.project_id))
    .filter((run) => !input.projectId || run.project_id === input.projectId)
    .filter((run): run is DbPipelineRun & { project_id: string } => Boolean(run.project_id))
    .sort((left, right) => workerPipelineRunQueuedAt(left) - workerPipelineRunQueuedAt(right))
    .slice(0, input.limit);

  return candidates.flatMap((run) => {
    const project = store.projects.find((row) => row.id === run.project_id);
    return project ? [{ run, identity: activeIdentityForProject(project) }] : [];
  });
}

async function attachWorkerIdentities(
  runs: DbPipelineRun[]
): Promise<Array<{ run: DbPipelineRun & { project_id: string }; identity: ActiveIdentity }>> {
  const scopedRuns = runs.filter((run): run is DbPipelineRun & { project_id: string } => Boolean(run.project_id));
  if (scopedRuns.length === 0) {
    return [];
  }
  const supabase = createSupabaseClient()!;
  const projectIds = uniqueStrings(scopedRuns.map((run) => run.project_id));
  const projects = await supabase.select<DbProject>(
    "projects",
    `select=id,owner_user_id,workspace_id&${projectIdsQuery(projectIds)}`
  );
  const projectsById = new Map(projects.map((project) => [project.id, project]));
  return scopedRuns.flatMap((run) => {
    const project = projectsById.get(run.project_id);
    return project ? [{ run, identity: activeIdentityForProject(project) }] : [];
  });
}

async function getProjectWorkerScope(projectId: string): Promise<DbProject | null> {
  if (isSupabaseConfigured()) {
    const supabase = createSupabaseClient()!;
    return (
      await supabase.select<DbProject>(
        "projects",
        `select=id,owner_user_id,workspace_id&id=eq.${encodeURIComponent(projectId)}&limit=1`
      )
    )[0] ?? null;
  }

  const store = await readLocalStore();
  return store.projects.find((project) => project.id === projectId) ?? null;
}

function activeIdentityForProject(project: Pick<DbProject, "id" | "owner_user_id" | "workspace_id">): ActiveIdentity {
  return {
    userId: project.owner_user_id || cleanEnv(process.env.FORGE_USER_ID) || "local-user",
    workspaceId: project.workspace_id || cleanEnv(process.env.FORGE_WORKSPACE_ID) || "local-workspace",
    authProvider: "local",
    authSubject: project.owner_user_id || cleanEnv(process.env.FORGE_AUTH_SUBJECT) || "worker"
  };
}

function projectIdsQuery(projectIds: string[]): string {
  return `id=in.(${projectIds.map(encodeURIComponent).join(",")})`;
}

function workerPipelineRunQueuedAt(run: Pick<DbPipelineRun, "started_at">): number {
  return run.started_at ? new Date(run.started_at).getTime() : 0;
}

function serverIdentityAllowedWhenAuthRequired(): boolean {
  return ["1", "true", "yes"].includes((process.env.FORGE_ALLOW_SERVER_IDENTITY_WHEN_AUTH_REQUIRED || "").toLowerCase());
}

async function resolveSupabaseAuthSubjectIdentity(
  authSubject: string,
  preferredWorkspaceId?: string
): Promise<{ userId: string; workspaceId: string } | null> {
  const supabase = createSupabaseClient();
  if (!supabase) return null;
  const identity = (
    await safeSelect<DbUserAuthIdentity>(
      supabase,
      "user_auth_identities",
      `select=*&provider=eq.supabase&subject=eq.${encodeURIComponent(authSubject)}&limit=1`
    )
  )[0];
  if (!identity?.user_id) return null;

  if (preferredWorkspaceId) {
    const membership = (
      await safeSelect<DbWorkspaceMember>(
        supabase,
        "workspace_members",
        `select=*&user_id=eq.${encodeURIComponent(identity.user_id)}&workspace_id=eq.${encodeURIComponent(preferredWorkspaceId)}&limit=1`
      )
    )[0];
    if (membership) {
      return { userId: identity.user_id, workspaceId: preferredWorkspaceId };
    }
  }

  const membership = (
    await safeSelect<DbWorkspaceMember>(
      supabase,
      "workspace_members",
      `select=*&user_id=eq.${encodeURIComponent(identity.user_id)}&limit=1`
    )
  )[0];
  if (membership?.workspace_id) {
    return { userId: identity.user_id, workspaceId: membership.workspace_id };
  }

  const workspace = (
    await safeSelect<DbWorkspace>(
      supabase,
      "workspaces",
      `select=*&owner_user_id=eq.${encodeURIComponent(identity.user_id)}&limit=1`
    )
  )[0];
  return workspace?.id ? { userId: identity.user_id, workspaceId: workspace.id } : null;
}

function cleanEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function ensureLocalIdentity(store: ForgeStore, identity: ActiveIdentity): void {
  const now = new Date().toISOString();
  if (!store.users.some((user) => user.id === identity.userId)) {
    store.users.push({
      id: identity.userId,
      email: identity.email ?? process.env.FORGE_USER_EMAIL ?? null,
      display_name: process.env.FORGE_USER_NAME || "Local Forge user",
      created_at: now
    });
  }
  if (!store.workspaces.some((workspace) => workspace.id === identity.workspaceId)) {
    store.workspaces.push({
      id: identity.workspaceId,
      name: process.env.FORGE_WORKSPACE_NAME || "Local workspace",
      owner_user_id: identity.userId,
      created_at: now
    });
  }
  if (
    !store.workspace_members.some(
      (member) => member.workspace_id === identity.workspaceId && member.user_id === identity.userId
    )
  ) {
    store.workspace_members.push({
      workspace_id: identity.workspaceId,
      user_id: identity.userId,
      role: "owner",
      created_at: now
    });
  }
  const authProvider = identity.authProvider ?? "local";
  const authSubject = identity.authSubject || process.env.FORGE_AUTH_SUBJECT || identity.userId;
  if (!store.user_auth_identities.some((row) => row.provider === authProvider && row.subject === authSubject)) {
    store.user_auth_identities.push({
      id: newId("auth"),
      user_id: identity.userId,
      provider: authProvider,
      subject: authSubject,
      email: identity.email ?? process.env.FORGE_USER_EMAIL ?? null,
      created_at: now,
      updated_at: now
    });
  }
}

async function ensureSupabaseIdentity(identity: ActiveIdentity): Promise<void> {
  const supabase = createSupabaseClient();
  if (!supabase) return;
  const now = new Date().toISOString();
  const user = (
    await supabase.select("users", `select=*&id=eq.${encodeURIComponent(identity.userId)}&limit=1`)
  )[0];
  if (!user) {
    await supabase.insert("users", {
      id: identity.userId,
      email: identity.email ?? process.env.FORGE_USER_EMAIL ?? null,
      display_name: process.env.FORGE_USER_NAME || "Forge user",
      created_at: now
    });
  }
  const workspace = (
    await supabase.select("workspaces", `select=*&id=eq.${encodeURIComponent(identity.workspaceId)}&limit=1`)
  )[0];
  if (!workspace) {
    await supabase.insert("workspaces", {
      id: identity.workspaceId,
      name: process.env.FORGE_WORKSPACE_NAME || "Forge workspace",
      owner_user_id: identity.userId,
      created_at: now
    });
  }
  const member = (
    await supabase.select(
      "workspace_members",
      `select=*&workspace_id=eq.${encodeURIComponent(identity.workspaceId)}&user_id=eq.${encodeURIComponent(identity.userId)}&limit=1`
    )
  )[0];
  if (!member) {
    await supabase.insert("workspace_members", {
      workspace_id: identity.workspaceId,
      user_id: identity.userId,
      role: "owner",
      created_at: now
    });
  }
  const authSubject = identity.authSubject || process.env.FORGE_AUTH_SUBJECT || identity.userId;
  const authIdentity = (
    await supabase.select(
      "user_auth_identities",
      `select=*&provider=eq.supabase&subject=eq.${encodeURIComponent(authSubject)}&limit=1`
    )
  )[0];
  if (!authIdentity) {
    await supabase.insert("user_auth_identities", {
      id: newId("auth"),
      user_id: identity.userId,
      provider: "supabase",
      subject: authSubject,
      email: identity.email ?? process.env.FORGE_USER_EMAIL ?? null,
      created_at: now,
      updated_at: now
    });
  }
}

export async function createProjectRecord(input: {
  name: string;
  mode: ProjectMode;
  repoUrl?: string | null;
  githubConnectionRequired?: boolean;
  productUrl?: string;
  description?: string;
  markets?: string[];
  riskTolerance?: string;
  notes?: string;
  scheduleCadence?: string;
}): Promise<DbProject> {
  const now = new Date().toISOString();
  const identity = await getActiveIdentity();
  const defaults = buildProjectDefaults({
    projectId: newId("proj"),
    mode: input.mode,
    name: input.name,
    repoUrl: input.repoUrl,
    githubConnectionRequired: input.githubConnectionRequired,
    productUrl: input.productUrl,
    description: input.description,
    markets: input.markets,
    riskTolerance: input.riskTolerance,
    notes: input.notes,
    scheduleCadence: input.scheduleCadence,
    now,
    idFactory: newId
  });

  if (isSupabaseConfigured()) {
    await ensureSupabaseIdentity(identity);
    const supabase = createSupabaseClient()!;
    const project = await supabase.insert("projects", {
      ...defaults.project,
      owner_user_id: identity.userId,
      workspace_id: identity.workspaceId
    });
    for (const source of defaults.sources) {
      await supabase.insert("source_configs", { ...source, project_id: project.id });
    }
    for (const trigger of defaults.triggers) {
      await supabase.insert("triggers", { ...trigger, project_id: project.id });
    }
    await supabase.insert("user_preferences", { ...defaults.preference, project_id: project.id });
    return project;
  }

  await mutateStore((store) => {
    ensureLocalIdentity(store, identity);
    store.projects.unshift({
      ...defaults.project,
      owner_user_id: identity.userId,
      workspace_id: identity.workspaceId
    });
    store.source_configs.push(...defaults.sources);
    store.triggers.push(...defaults.triggers);
    store.user_preferences.push(defaults.preference);
  });

  return defaults.project;
}

export async function updateProjectRepository(input: {
  projectId: string;
  repoUrl: string;
  productContext?: string;
  connectionId?: string;
}): Promise<void> {
  await assertProjectAccessible(input.projectId);
  if (input.connectionId) {
    await assertGitHubConnectionUsableForProject({
      projectId: input.projectId,
      connectionId: input.connectionId
    });
  }

  const now = new Date().toISOString();
  const githubPatch = githubSourcePatch(input.repoUrl);
  const normalizedRepoUrl = normalizeGithubRepository(input.repoUrl)?.repoUrl ?? input.repoUrl;
  const patch = {
    repo_url: normalizedRepoUrl,
    description: input.productContext,
    updated_at: now
  };

  if (isSupabaseConfigured()) {
    const supabase = createSupabaseClient()!;
    await supabase.update("projects", input.projectId, patch);
    if (githubPatch) {
      const githubSources = await supabase.select<DbSourceConfig>(
        "source_configs",
        `select=*&project_id=eq.${encodeURIComponent(input.projectId)}&source_type=eq.github&limit=1`
      );
      const source = githubSources[0];
      if (source) {
        await supabase.update("source_configs", source.id, {
          ...githubPatch,
          ...(input.connectionId ? { connection_id: input.connectionId } : {})
        });
      } else {
        await supabase.insert("source_configs", {
          id: newId("src"),
          project_id: input.projectId,
          connection_id: input.connectionId,
          source_type: "github",
          ...githubPatch
        });
      }
    }
    return;
  }

  await mutateStore((store) => {
    const project = store.projects.find((row) => row.id === input.projectId);
    if (project) {
      project.repo_url = normalizedRepoUrl;
      project.description = input.productContext ?? project.description;
      project.updated_at = now;
    }
    const source = store.source_configs.find(
      (row) => row.project_id === input.projectId && row.source_type === "github"
    );
    if (source) {
      source.status = "active";
      source.config = { ...(source.config ?? {}), repo_url: normalizedRepoUrl };
      if (input.connectionId) {
        source.connection_id = input.connectionId;
      }
      if (githubPatch) {
        Object.assign(source, githubPatch);
      }
    } else {
      store.source_configs.push({
        id: newId("src"),
        project_id: input.projectId,
        connection_id: input.connectionId,
        source_type: "github",
        name: githubPatch?.name ?? "GitHub issues",
        status: "active",
        config: githubPatch?.config ?? { repo_url: normalizedRepoUrl }
      });
    }
  });
}

export async function setProjectGeneratedRepoTargetConnection(input: {
  projectId: string;
  connectionId: string;
  accountLogin: string;
  repoCreation?: string;
}): Promise<void> {
  await assertProjectAccessible(input.projectId);
  await assertGitHubConnectionUsableForProject({
    projectId: input.projectId,
    connectionId: input.connectionId
  });

  const now = new Date().toISOString();
  if (isSupabaseConfigured()) {
    const supabase = createSupabaseClient()!;
    const existing = (
      await supabase.select<DbSourceConfig>(
        "source_configs",
        `select=*&project_id=eq.${encodeURIComponent(input.projectId)}&source_type=eq.${GENERATED_REPO_TARGET_SOURCE_TYPE}&limit=1`
      )
    )[0];
    const source = generatedRepoTargetSource({
      id: existing?.id ?? newId("src"),
      projectId: input.projectId,
      connectionId: input.connectionId,
      accountLogin: input.accountLogin,
      repoCreation: input.repoCreation,
      now
    });
    if (existing) {
      await supabase.update("source_configs", existing.id, source);
    } else {
      await supabase.insert("source_configs", source);
    }
    return;
  }

  await mutateStore((store) => {
    const existing = store.source_configs.find(
      (source) =>
        source.project_id === input.projectId &&
        source.source_type === GENERATED_REPO_TARGET_SOURCE_TYPE
    );
    const source = generatedRepoTargetSource({
      id: existing?.id ?? newId("src"),
      projectId: input.projectId,
      connectionId: input.connectionId,
      accountLogin: input.accountLogin,
      repoCreation: input.repoCreation,
      now
    });
    if (existing) {
      Object.assign(existing, source);
    } else {
      store.source_configs.push(source);
    }
  });
}

export async function upsertGitHubConnection(input: {
  accountLogin: string;
  accountType?: "User" | "Organization" | null;
  installationId?: string | null;
  provider?: "github_app" | "github_oauth";
  scopes?: string[];
}): Promise<DbGitHubConnection> {
  const identity = await getActiveIdentity();
  const now = new Date().toISOString();

  if (isSupabaseConfigured()) {
    await ensureSupabaseIdentity(identity);
    const supabase = createSupabaseClient()!;
    const existing = (
      await supabase.select<DbGitHubConnection>(
        "github_connections",
        `select=*&owner_user_id=eq.${encodeURIComponent(identity.userId)}&provider=eq.${encodeURIComponent(input.provider ?? "github_app")}&account_login=eq.${encodeURIComponent(input.accountLogin)}&limit=1`
      )
    )[0];
    if (existing) {
      return supabase.update("github_connections", existing.id, {
        ...existing,
        account_type: input.accountType ?? existing.account_type,
        installation_id: input.installationId ?? existing.installation_id,
        provider: input.provider ?? existing.provider,
        scopes: input.scopes ?? existing.scopes ?? [],
        status: "active",
        updated_at: now
      });
    }
    return supabase.insert("github_connections", {
      id: newId("gh"),
      owner_user_id: identity.userId,
      workspace_id: identity.workspaceId,
      provider: input.provider ?? "github_app",
      account_login: input.accountLogin,
      account_type: input.accountType ?? null,
      installation_id: input.installationId ?? null,
      scopes: input.scopes ?? [],
      status: "active",
      created_at: now,
      updated_at: now
    });
  }

  let connection: DbGitHubConnection | undefined;
  await mutateStore((store) => {
    ensureLocalIdentity(store, identity);
    connection = store.github_connections.find(
      (row) =>
        row.owner_user_id === identity.userId &&
        row.provider === (input.provider ?? "github_app") &&
        row.account_login === input.accountLogin
    );
    if (connection) {
      Object.assign(connection, {
        account_type: input.accountType ?? connection.account_type,
        installation_id: input.installationId ?? connection.installation_id,
        provider: input.provider ?? connection.provider,
        scopes: input.scopes ?? connection.scopes ?? [],
        status: "active",
        updated_at: now
      });
      return;
    }
    connection = {
      id: newId("gh"),
      owner_user_id: identity.userId,
      workspace_id: identity.workspaceId,
      provider: input.provider ?? "github_app",
      account_login: input.accountLogin,
      account_type: input.accountType ?? null,
      installation_id: input.installationId ?? null,
      scopes: input.scopes ?? [],
      status: "active",
      created_at: now,
      updated_at: now
    };
    store.github_connections.unshift(connection);
  });

  return connection!;
}

export async function upsertGitHubUserToken(input: {
  connectionId: string;
  accessToken: string;
  tokenType?: string | null;
  expiresAt?: string | null;
  refreshToken?: string | null;
  refreshTokenExpiresAt?: string | null;
  scopes?: string[];
}): Promise<DbGitHubUserToken> {
  const identity = await getActiveIdentity();
  const now = new Date().toISOString();

  if (isSupabaseConfigured()) {
    const supabase = createSupabaseClient()!;
    const connection = (
      await supabase.select<DbGitHubConnection>(
        "github_connections",
        `select=*&id=eq.${encodeURIComponent(input.connectionId)}&owner_user_id=eq.${encodeURIComponent(identity.userId)}&limit=1`
      )
    )[0];
    if (!connection) {
      throw new Error("GitHub connection not found.");
    }
    const existing = (
      await supabase.select<DbGitHubUserToken>(
        "github_user_tokens",
        `select=*&connection_id=eq.${encodeURIComponent(input.connectionId)}&owner_user_id=eq.${encodeURIComponent(identity.userId)}&limit=1`
      )
    )[0];
    const row = {
      connection_id: input.connectionId,
      owner_user_id: identity.userId,
      access_token: encryptSecretForStorage(input.accessToken)!,
      token_type: input.tokenType ?? "bearer",
      expires_at: input.expiresAt ?? null,
      refresh_token: input.refreshToken ? encryptSecretForStorage(input.refreshToken) : existing?.refresh_token ?? null,
      refresh_token_expires_at: input.refreshTokenExpiresAt ?? existing?.refresh_token_expires_at ?? null,
      scopes: input.scopes ?? existing?.scopes ?? [],
      updated_at: now
    };
    if (existing) {
      return supabase.update<Partial<DbGitHubUserToken>>("github_user_tokens", existing.id, row) as Promise<DbGitHubUserToken>;
    }
    return supabase.insert("github_user_tokens", {
      id: newId("gh_tok"),
      ...row,
      created_at: now
    });
  }

  let token: DbGitHubUserToken | undefined;
  await mutateStore((store) => {
    const connection = store.github_connections.find(
      (row) => row.id === input.connectionId && row.owner_user_id === identity.userId
    );
    if (!connection) {
      throw new Error("GitHub connection not found.");
    }
    token = store.github_user_tokens.find(
      (row) => row.connection_id === input.connectionId && row.owner_user_id === identity.userId
    );
    if (token) {
      Object.assign(token, {
        owner_user_id: identity.userId,
        access_token: encryptSecretForStorage(input.accessToken)!,
        token_type: input.tokenType ?? "bearer",
        expires_at: input.expiresAt ?? null,
        refresh_token: input.refreshToken ? encryptSecretForStorage(input.refreshToken) : token.refresh_token ?? null,
        refresh_token_expires_at: input.refreshTokenExpiresAt ?? token.refresh_token_expires_at ?? null,
        scopes: input.scopes ?? token.scopes ?? [],
        updated_at: now
      });
      return;
    }
    token = {
      id: newId("gh_tok"),
      connection_id: input.connectionId,
      owner_user_id: identity.userId,
      access_token: encryptSecretForStorage(input.accessToken)!,
      token_type: input.tokenType ?? "bearer",
      expires_at: input.expiresAt ?? null,
      refresh_token: encryptSecretForStorage(input.refreshToken),
      refresh_token_expires_at: input.refreshTokenExpiresAt ?? null,
      scopes: input.scopes ?? [],
      created_at: now,
      updated_at: now
    };
    store.github_user_tokens.unshift(token);
  });

  return token!;
}

export async function getGitHubUserTokenForConnection(
  connectionId: string
): Promise<DbGitHubUserToken | null> {
  const identity = await getActiveIdentity();

  if (isSupabaseConfigured()) {
    const supabase = createSupabaseClient()!;
    const connection = (
      await supabase.select<DbGitHubConnection>(
        "github_connections",
        `select=id,owner_user_id&id=eq.${encodeURIComponent(connectionId)}&owner_user_id=eq.${encodeURIComponent(identity.userId)}&limit=1`
      )
    )[0];
    if (!connection) return null;
    const token = (
      await supabase.select<DbGitHubUserToken>(
        "github_user_tokens",
        `select=*&connection_id=eq.${encodeURIComponent(connectionId)}&owner_user_id=eq.${encodeURIComponent(identity.userId)}&limit=1`
      )
    )[0] ?? null;
    return token ? decryptGitHubUserToken(token) : null;
  }

  const store = await readLocalStore();
  const connection = store.github_connections.find(
    (row) => row.id === connectionId && row.owner_user_id === identity.userId
  );
  if (!connection) return null;
  const token = (
    store.github_user_tokens.find(
      (row) => row.connection_id === connectionId && row.owner_user_id === identity.userId
    ) ?? null
  );
  return token ? decryptGitHubUserToken(token) : null;
}

function decryptGitHubUserToken(token: DbGitHubUserToken): DbGitHubUserToken {
  return {
    ...token,
    access_token: decryptSecretFromStorage(token.access_token)!,
    refresh_token: decryptSecretFromStorage(token.refresh_token)
  };
}

export async function updateGitHubConnectionStatus(input: {
  connectionId: string;
  status: DbGitHubConnection["status"];
}): Promise<DbGitHubConnection | null> {
  const identity = await getActiveIdentity();
  const now = new Date().toISOString();

  if (isSupabaseConfigured()) {
    const supabase = createSupabaseClient()!;
    const existing = (
      await supabase.select<DbGitHubConnection>(
        "github_connections",
        `select=*&id=eq.${encodeURIComponent(input.connectionId)}&owner_user_id=eq.${encodeURIComponent(identity.userId)}&limit=1`
      )
    )[0];
    if (!existing) return null;
    return supabase.update("github_connections", existing.id, {
      ...existing,
      status: input.status,
      updated_at: now
    });
  }

  let connection: DbGitHubConnection | null = null;
  await mutateStore((store) => {
    const existing = store.github_connections.find(
      (row) => row.id === input.connectionId && row.owner_user_id === identity.userId
    );
    if (!existing) return;
    existing.status = input.status;
    existing.updated_at = now;
    connection = existing;
  });

  return connection;
}

export async function updateGitHubConnectionsByInstallation(input: {
  installationId: string;
  status: DbGitHubConnection["status"];
}): Promise<number> {
  const now = new Date().toISOString();

  if (isSupabaseConfigured()) {
    const supabase = createSupabaseClient()!;
    const matches = await supabase.select<DbGitHubConnection>(
      "github_connections",
      `select=*&installation_id=eq.${encodeURIComponent(input.installationId)}`
    );
    for (const connection of matches) {
      await supabase.update("github_connections", connection.id, {
        ...connection,
        status: input.status,
        updated_at: now
      });
    }
    return matches.length;
  }

  let updated = 0;
  await mutateStore((store) => {
    for (const connection of store.github_connections) {
      if (connection.installation_id !== input.installationId) {
        continue;
      }
      connection.status = input.status;
      connection.updated_at = now;
      updated += 1;
    }
  });

  return updated;
}

export async function createIdeaConversation(projectId: string, firstMessage: string): Promise<{
  conversation: DbIdeaConversation;
  userMessage: DbIdeaMessage;
}> {
  await assertProjectAccessible(projectId);

  const identity = await getActiveIdentity();
  const now = new Date().toISOString();
  const conversation: DbIdeaConversation = {
    id: newId("conv"),
    project_id: projectId,
    user_id: identity.userId,
    title: summarizeTitle(firstMessage),
    status: "active",
    created_at: now,
    updated_at: now
  };
  const userMessage: DbIdeaMessage = {
    id: newId("msg"),
    conversation_id: conversation.id,
    role: "user",
    content: firstMessage,
    created_at: now
  };

  if (isSupabaseConfigured()) {
    const supabase = createSupabaseClient()!;
    const insertedConversation = await supabase.insert("idea_conversations", conversation);
    const insertedMessage = await supabase.insert("idea_messages", userMessage);
    return { conversation: insertedConversation, userMessage: insertedMessage };
  }

  await mutateStore((store) => {
    ensureLocalIdentity(store, identity);
    store.idea_conversations.unshift(conversation);
    store.idea_messages.push(userMessage);
  });

  return { conversation, userMessage };
}

export async function addIdeaMessage(input: {
  projectId: string;
  conversationId: string;
  role: DbIdeaMessage["role"];
  content: string;
  metadata?: JsonObject;
}): Promise<DbIdeaMessage> {
  await assertConversationBelongsToProject({
    projectId: input.projectId,
    conversationId: input.conversationId
  });

  const now = new Date().toISOString();
  const message: DbIdeaMessage = {
    id: newId("msg"),
    conversation_id: input.conversationId,
    role: input.role,
    content: input.content,
    metadata: input.metadata,
    created_at: now
  };

  if (isSupabaseConfigured()) {
    const supabase = createSupabaseClient()!;
    const inserted = await supabase.insert("idea_messages", message);
    await supabase.update("idea_conversations", input.conversationId, { updated_at: now });
    return inserted;
  }

  await mutateStore((store) => {
    store.idea_messages.push(message);
    const conversation = store.idea_conversations.find((row) => row.id === input.conversationId);
    if (conversation) {
      conversation.updated_at = now;
    }
  });

  return message;
}

export async function saveResearchBrief(
  brief: Omit<DbResearchBrief, "id" | "created_at" | "updated_at">
): Promise<DbResearchBrief> {
  await assertProjectAccessible(brief.project_id);
  if (brief.conversation_id) {
    await assertConversationBelongsToProject({
      projectId: brief.project_id,
      conversationId: brief.conversation_id
    });
  }

  const now = new Date().toISOString();
  const row: DbResearchBrief = {
    id: newId("brief"),
    ...brief,
    created_at: now,
    updated_at: now
  };

  if (isSupabaseConfigured()) {
    const supabase = createSupabaseClient()!;
    const inserted = await supabase.insert("research_briefs", row);
    if (brief.conversation_id) {
      await supabase.update("idea_conversations", brief.conversation_id, {
        status: conversationStatusForResearchBriefStatus(brief.status),
        updated_at: now
      });
    }
    return inserted;
  }

  await mutateStore((store) => {
    store.research_briefs.unshift(row);
    if (brief.conversation_id) {
      const conversation = store.idea_conversations.find((entry) => entry.id === brief.conversation_id);
      if (conversation) {
        conversation.status = conversationStatusForResearchBriefStatus(brief.status);
        conversation.updated_at = now;
      }
    }
  });

  return row;
}

export async function updateResearchBriefStatus(input: {
  projectId: string;
  briefId: string;
  status: DbResearchBrief["status"];
}): Promise<void> {
  await assertResearchBriefBelongsToProject({
    projectId: input.projectId,
    briefId: input.briefId
  });
  const patch = { status: input.status, updated_at: new Date().toISOString() };

  if (isSupabaseConfigured()) {
    const supabase = createSupabaseClient()!;
    await supabase.update("research_briefs", input.briefId, patch);
    const brief = (
      await supabase.select<DbResearchBrief>(
        "research_briefs",
        `select=id,conversation_id&id=eq.${encodeURIComponent(input.briefId)}&limit=1`
      )
    )[0];
    if (brief?.conversation_id) {
      await supabase.update("idea_conversations", brief.conversation_id, {
        status: conversationStatusForResearchBriefStatus(input.status),
        updated_at: patch.updated_at
      });
    }
    return;
  }

  await mutateStore((store) => {
    const brief = store.research_briefs.find((row) => row.id === input.briefId);
    if (brief) {
      Object.assign(brief, patch);
      if (brief.conversation_id) {
        const conversation = store.idea_conversations.find((row) => row.id === brief.conversation_id);
        if (conversation) {
          conversation.status = conversationStatusForResearchBriefStatus(input.status);
          conversation.updated_at = patch.updated_at;
        }
      }
    }
  });
}

export async function createAgentTasks(
  tasks: Array<Omit<DbAgentTask, "id" | "created_at" | "updated_at" | "status"> & { status?: DbAgentTask["status"] }>
): Promise<DbAgentTask[]> {
  if (tasks.length === 0) {
    return [];
  }
  for (const task of tasks) {
    await assertProjectAccessible(task.project_id);
    if (task.pipeline_run_id) {
      await assertPipelineRunBelongsToProject({
        projectId: task.project_id,
        runId: task.pipeline_run_id
      });
    }
    if (task.research_brief_id) {
      await assertResearchBriefBelongsToProject({
        projectId: task.project_id,
        briefId: task.research_brief_id
      });
    }
  }

  const now = new Date().toISOString();
  const rows: DbAgentTask[] = tasks.map((task) => ({
    id: newId("task"),
    status: task.status ?? "queued",
    ...task,
    created_at: now,
    updated_at: now
  }));

  if (isSupabaseConfigured()) {
    const supabase = createSupabaseClient()!;
    const inserted: DbAgentTask[] = [];
    for (const row of rows) {
      inserted.push(await supabase.insert("agent_tasks", row));
    }
    return inserted;
  }

  await mutateStore((store) => {
    store.agent_tasks.unshift(...rows);
  });

  return rows;
}

export async function updateAgentTasks(
  projectId: string,
  updates: Array<{
    id: string;
    status: DbAgentTask["status"];
    result?: JsonObject;
    error?: string;
  }>
): Promise<void> {
  if (updates.length === 0) {
    return;
  }
  for (const update of updates) {
    await assertAgentTaskBelongsToProject({ projectId, taskId: update.id });
  }
  const now = new Date().toISOString();

  if (isSupabaseConfigured()) {
    const supabase = createSupabaseClient()!;
    for (const update of updates) {
      await supabase.update("agent_tasks", update.id, {
        status: update.status,
        result: update.result,
        error: update.error,
        updated_at: now
      });
    }
    return;
  }

  await mutateStore((store) => {
    for (const update of updates) {
      const task = store.agent_tasks.find((row) => row.id === update.id);
      if (task) {
        task.status = update.status;
        task.result = update.result;
        task.error = update.error;
        task.updated_at = now;
      }
    }
  });
}

export async function replaceProjectDiscoveryRecords(input: {
  projectId: string;
  runId: string;
  signals: Array<Omit<DbSignal, "id" | "project_id"> & { id?: string }>;
  opportunities: Array<
    Omit<DbOpportunity, "id" | "project_id" | "pipeline_run_id"> & {
      id?: string;
      signalIndexes: number[];
      evaluations?: Array<Omit<DbEvaluation, "id" | "opportunity_id">>;
    }
  >;
}): Promise<void> {
  await assertProjectAccessible(input.projectId);
  await assertPipelineRunBelongsToProject({
    projectId: input.projectId,
    runId: input.runId
  });

  const now = new Date().toISOString();
  const signalRows: DbSignal[] = input.signals.map((signal) => ({
    id: signal.id ?? newId("sig"),
    project_id: input.projectId,
    source: signal.source,
    title: signal.title,
    body: signal.body,
    url: signal.url
  }));

  const opportunityRows: DbOpportunity[] = input.opportunities.map((opportunity) => ({
    id: opportunity.id ?? newId("opp"),
    project_id: input.projectId,
    pipeline_run_id: input.runId,
    title: opportunity.title,
    problem: opportunity.problem,
    target_user: opportunity.target_user,
    mvp_concept: opportunity.mvp_concept,
    score: opportunity.score,
    score_rationale: opportunity.score_rationale,
    status: opportunity.status ?? "proposed",
    profile: opportunity.profile,
    created_at: now,
    updated_at: now
  }));

  const links: DbOpportunitySignal[] = input.opportunities.flatMap((opportunity, opportunityIndex) =>
    opportunity.signalIndexes
      .map((signalIndex) => signalRows[signalIndex])
      .filter((signal): signal is DbSignal => Boolean(signal))
      .map((signal) => ({
        opportunity_id: opportunityRows[opportunityIndex].id,
        signal_id: signal.id
      }))
  );

  const evaluations: DbEvaluation[] = input.opportunities.flatMap((opportunity, opportunityIndex) =>
    (opportunity.evaluations ?? []).map((evaluation) => ({
      id: newId("eval"),
      opportunity_id: opportunityRows[opportunityIndex].id,
      evaluator: evaluation.evaluator,
      content: evaluation.content,
      scores: evaluation.scores
    }))
  );
  const prototypeRows = opportunityRows.map((opportunity) => ({
    id: newId("proto"),
    project_id: input.projectId,
    opportunity_id: opportunity.id,
    prototype_type: "clickable_demo",
    ...createPrototypeOptionDraft(opportunity)
  }));

  if (isSupabaseConfigured()) {
    const supabase = createSupabaseClient()!;
    const oldOpportunities = await supabase.select<DbOpportunity>(
      "opportunities",
      `select=id&project_id=eq.${encodeURIComponent(input.projectId)}&pipeline_run_id=not.is.null`
    );
    const oldOpportunityIds = oldOpportunities.map((opportunity) => opportunity.id);
    if (oldOpportunityIds.length > 0) {
      const oldOpportunityFilter = `(${oldOpportunityIds.join(",")})`;
      const oldBuilds = await supabase.select<DbMvpBuild>(
        "mvp_builds",
        `select=id&opportunity_id=in.${oldOpportunityFilter}`
      );
      const oldBuildIds = oldBuilds.map((build) => build.id);
      if (oldBuildIds.length > 0) {
        await supabase.delete("build_artifacts", `mvp_build_id=in.(${oldBuildIds.join(",")})`);
        await supabase.delete("mvp_builds", `id=in.(${oldBuildIds.join(",")})`);
      }
      await supabase.delete("prototype_options", `opportunity_id=in.${oldOpportunityFilter}`);
      await supabase.delete("opportunity_evaluations", `opportunity_id=in.${oldOpportunityFilter}`);
      await supabase.delete("opportunity_signals", `opportunity_id=in.${oldOpportunityFilter}`);
      await supabase.delete("opportunities", `id=in.${oldOpportunityFilter}`);
    }
    await supabase.delete("signals", `project_id=eq.${encodeURIComponent(input.projectId)}`);
    for (const signal of signalRows) await supabase.insert("signals", signal);
    for (const opportunity of opportunityRows) await supabase.insert("opportunities", opportunity);
    for (const link of links) await supabase.insert("opportunity_signals", link);
    for (const evaluation of evaluations) await supabase.insert("opportunity_evaluations", evaluation);
    for (const prototype of prototypeRows) await supabase.insert("prototype_options", prototype);
    return;
  }

  await mutateStore((store) => {
    const oldOpportunityIds = new Set(
      store.opportunities
        .filter((row) => row.project_id === input.projectId && row.pipeline_run_id)
        .map((row) => row.id)
    );
    const oldSignalIds = new Set(
      store.signals.filter((row) => row.project_id === input.projectId).map((row) => row.id)
    );

    store.build_artifacts = store.build_artifacts.filter((artifact) =>
      store.mvp_builds.some(
        (build) => build.id === artifact.mvp_build_id && !oldOpportunityIds.has(build.opportunity_id ?? "")
      )
    );
    store.mvp_builds = store.mvp_builds.filter((build) => !oldOpportunityIds.has(build.opportunity_id ?? ""));
    store.prototype_options = store.prototype_options.filter(
      (prototype) => !oldOpportunityIds.has(prototype.opportunity_id ?? "")
    );
    store.opportunity_evaluations = store.opportunity_evaluations.filter(
      (evaluation) => !oldOpportunityIds.has(evaluation.opportunity_id ?? "")
    );
    store.opportunity_signals = store.opportunity_signals.filter(
      (link) => !oldOpportunityIds.has(link.opportunity_id) && !oldSignalIds.has(link.signal_id)
    );
    store.opportunities = store.opportunities.filter((row) => !oldOpportunityIds.has(row.id));
    store.signals = store.signals.filter((row) => !oldSignalIds.has(row.id));

    store.signals.unshift(...signalRows);
    store.opportunities.unshift(...opportunityRows);
    store.opportunity_signals.unshift(...links);
    store.opportunity_evaluations.unshift(...evaluations);
    store.prototype_options.unshift(...prototypeRows);
  });
}

export async function recordPreferenceEvent(input: {
  projectId: string;
  eventType: string;
  opportunityId?: string;
  mvpBuildId?: string;
  payload?: JsonObject;
}): Promise<DbPreferenceEvent> {
  await assertProjectAccessible(input.projectId);
  if (input.opportunityId) {
    await assertOpportunityBelongsToProject({
      projectId: input.projectId,
      opportunityId: input.opportunityId
    });
  }
  if (input.mvpBuildId) {
    await assertMvpBuildBelongsToProject({
      projectId: input.projectId,
      buildId: input.mvpBuildId
    });
  }
  if (input.mvpBuildId && input.opportunityId) {
    await assertMvpBuildBelongsToOpportunity({
      buildId: input.mvpBuildId,
      opportunityId: input.opportunityId
    });
  }

  const event: DbPreferenceEvent = {
    id: newId("evt"),
    project_id: input.projectId,
    opportunity_id: input.opportunityId,
    event_type: input.eventType,
    mvp_build_id: input.mvpBuildId,
    payload: input.payload ?? {},
    created_at: new Date().toISOString()
  };

  if (isSupabaseConfigured()) {
    const supabase = createSupabaseClient()!;
    const inserted = await supabase.insert("preference_events", event);
    const opportunityStatus = input.opportunityId ? opportunityStatusForPreferenceEvent(input.eventType) : null;
    if (input.opportunityId && opportunityStatus) {
      await supabase.update("opportunities", input.opportunityId, {
        status: opportunityStatus,
        updated_at: new Date().toISOString()
      });
    }
    return inserted;
  }

  await mutateStore((store) => {
    store.preference_events.unshift(event);
    if (!input.opportunityId) {
      return;
    }
    const opportunity = store.opportunities.find((row) => row.id === input.opportunityId);
    if (opportunity) {
      const opportunityStatus = opportunityStatusForPreferenceEvent(input.eventType);
      if (opportunityStatus) opportunity.status = opportunityStatus;
    }
  });

  return event;
}

export async function updateOpportunityStatus(input: {
  projectId: string;
  opportunityId: string;
  status: string;
}): Promise<void> {
  await assertOpportunityBelongsToProject({
    projectId: input.projectId,
    opportunityId: input.opportunityId
  });

  if (isSupabaseConfigured()) {
    const supabase = createSupabaseClient()!;
    await supabase.update("opportunities", input.opportunityId, {
      status: input.status,
      updated_at: new Date().toISOString()
    });
    return;
  }

  await mutateStore((store) => {
    const opportunity = store.opportunities.find((row) => row.id === input.opportunityId);
    if (opportunity) {
      opportunity.status = input.status;
    }
  });
}

export async function createMvpBuild(input: {
  projectId: string;
  opportunityId: string;
  buildBrief: JsonObject;
}): Promise<DbMvpBuild> {
  await assertOpportunityBelongsToProject({
    projectId: input.projectId,
    opportunityId: input.opportunityId
  });

  const now = new Date().toISOString();
  const build: DbMvpBuild = {
    id: newId("build"),
    project_id: input.projectId,
    opportunity_id: input.opportunityId,
    status: "queued",
    build_brief: input.buildBrief,
    template_repo_url: "https://github.com/forge-labs/mvp-template",
    created_at: now,
    updated_at: now
  };

  if (isSupabaseConfigured()) {
    const supabase = createSupabaseClient()!;
    return supabase.insert("mvp_builds", build);
  }

  await mutateStore((store) => {
    store.mvp_builds.unshift(build);
  });

  return build;
}

export async function createReflectionRun(input: {
  projectId: string;
  summary: string;
  evidence: JsonObject;
  proposals: Array<Omit<DbReflectionProposal, "id" | "reflection_run_id" | "status">>;
}): Promise<DbReflectionRun> {
  await assertProjectAccessible(input.projectId);

  const now = new Date().toISOString();
  const run: DbReflectionRun = {
    id: newId("refl_run"),
    project_id: input.projectId,
    status: "completed",
    summary: input.summary,
    evidence: input.evidence,
    created_at: now,
    completed_at: now
  };
  const proposals: DbReflectionProposal[] = input.proposals.map((proposal) => ({
    id: newId("refl_prop"),
    reflection_run_id: run.id,
    proposal_type: proposal.proposal_type,
    risk_level: proposal.risk_level,
    title: proposal.title,
    rationale: proposal.rationale,
    patch: proposal.patch,
    status: "proposed"
  }));

  if (isSupabaseConfigured()) {
    const supabase = createSupabaseClient()!;
    const insertedRun = await supabase.insert("reflection_runs", run);
    for (const proposal of proposals) {
      await supabase.insert("reflection_proposals", proposal);
    }
    return insertedRun;
  }

  await mutateStore((store) => {
    store.reflection_runs.unshift(run);
    store.reflection_proposals.unshift(...proposals);
  });

  return run;
}

export async function updateMvpBuild(input: {
  projectId: string;
  buildId: string;
  patch: Partial<DbMvpBuild>;
}): Promise<DbMvpBuild> {
  await assertMvpBuildBelongsToProject({
    projectId: input.projectId,
    buildId: input.buildId
  });

  const payload = { ...input.patch, updated_at: new Date().toISOString() };

  if (isSupabaseConfigured()) {
    const supabase = createSupabaseClient()!;
    return (await supabase.update<Partial<DbMvpBuild>>("mvp_builds", input.buildId, payload)) as DbMvpBuild;
  }

  await mutateStore((store) => {
    const index = store.mvp_builds.findIndex(
      (row) => row.id === input.buildId && projectChildBelongsToProject(row, input.projectId)
    );
    if (index >= 0) {
      store.mvp_builds[index] = { ...store.mvp_builds[index], ...payload };
    }
  });

  const store = await readLocalStore();
  return (
    store.mvp_builds.find(
      (row) => row.id === input.buildId && projectChildBelongsToProject(row, input.projectId)
    ) ?? { id: input.buildId, project_id: input.projectId, ...payload }
  ) as DbMvpBuild;
}

export async function insertBuildArtifacts(input: {
  projectId: string;
  buildId: string;
  artifacts: Array<Omit<DbBuildArtifact, "id" | "mvp_build_id">>;
}): Promise<DbBuildArtifact[]> {
  await assertMvpBuildBelongsToProject({
    projectId: input.projectId,
    buildId: input.buildId
  });

  const rows = input.artifacts.map((artifact) => ({
    id: newId("art"),
    mvp_build_id: input.buildId,
    ...artifact
  }));

  if (isSupabaseConfigured()) {
    const supabase = createSupabaseClient()!;
    const inserted: DbBuildArtifact[] = [];
    for (const row of rows) {
      inserted.push(await supabase.insert("build_artifacts", row));
    }
    return inserted;
  }

  await mutateStore((store) => {
    store.build_artifacts.unshift(...rows);
  });

  return rows;
}

export async function createPipelineRun(
  projectId: string,
  input: { researchBriefId?: string; status?: DbPipelineRun["status"]; metadata?: JsonObject } = {}
): Promise<DbPipelineRun> {
  await assertProjectAccessible(projectId);

  if (input.researchBriefId) {
    await assertResearchBriefBelongsToProject({
      projectId,
      briefId: input.researchBriefId
    });
  }

  const now = new Date().toISOString();
  const run: DbPipelineRun = {
    id: newId("run"),
    project_id: projectId,
    research_brief_id: input.researchBriefId,
    run_type: "managed",
    status: input.status ?? "running",
    trigger: "manual",
    started_at: now,
    metadata: input.metadata ?? { source: "dashboard" }
  };

  if (isSupabaseConfigured()) {
    const supabase = createSupabaseClient()!;
    return supabase.insert("pipeline_runs", run);
  }

  await mutateStore((store) => {
    store.pipeline_runs.unshift(run);
  });

  return run;
}

export async function updatePipelineRunStatus(
  projectId: string,
  runId: string,
  input: { status: DbPipelineRun["status"]; metadata?: JsonObject | null }
): Promise<void> {
  await assertPipelineRunBelongsToProject({ projectId, runId });

  const patch: Partial<DbPipelineRun> = {
    status: input.status,
    metadata: input.metadata === undefined ? undefined : input.metadata,
    completed_at: input.status === "completed" || input.status === "failed" ? new Date().toISOString() : undefined
  };

  if (isSupabaseConfigured()) {
    const supabase = createSupabaseClient()!;
    await supabase.update(
      "pipeline_runs",
      runId,
      Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined))
    );
    return;
  }

  await mutateStore((store) => {
    const run = store.pipeline_runs.find((row) => row.id === runId);
    if (run) {
      Object.assign(run, Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)));
    }
  });
}

export async function completePipelineRun(projectId: string, runId: string, metadata: JsonObject): Promise<void> {
  await assertPipelineRunBelongsToProject({ projectId, runId });

  const patch = {
    status: "completed",
    completed_at: new Date().toISOString(),
    metadata
  };

  if (isSupabaseConfigured()) {
    const supabase = createSupabaseClient()!;
    await supabase.update("pipeline_runs", runId, patch);
    return;
  }

  await mutateStore((store) => {
    const run = store.pipeline_runs.find((row) => row.id === runId);
    if (run) {
      Object.assign(run, patch);
    }
  });
}

export async function failPipelineRun(projectId: string, runId: string, metadata: JsonObject): Promise<void> {
  await assertPipelineRunBelongsToProject({ projectId, runId });

  const patch = {
    status: "failed",
    completed_at: new Date().toISOString(),
    metadata
  };

  if (isSupabaseConfigured()) {
    const supabase = createSupabaseClient()!;
    await supabase.update("pipeline_runs", runId, patch);
    return;
  }

  await mutateStore((store) => {
    const run = store.pipeline_runs.find((row) => row.id === runId);
    if (run) {
      Object.assign(run, patch);
    }
  });
}

export async function updateProjectSettings(input: {
  projectId: string;
  project: Pick<DbProject, "product_url" | "description">;
  preferences: Pick<DbUserPreference, "preferred_markets" | "risk_tolerance" | "notes">;
  sources: Array<Pick<DbSourceConfig, "id" | "status">>;
  triggers: Array<Pick<DbTrigger, "id" | "status"> & { config?: JsonObject }>;
}): Promise<void> {
  await assertProjectAccessible(input.projectId);

  const now = new Date().toISOString();

  if (isSupabaseConfigured()) {
    const supabase = createSupabaseClient()!;
    await supabase.update("projects", input.projectId, {
      product_url: input.project.product_url,
      description: input.project.description,
      updated_at: now
    });
    const pref = (
      await supabase.select<DbUserPreference>(
        "user_preferences",
        `select=*&project_id=eq.${encodeURIComponent(input.projectId)}&limit=1`
      )
    )[0];
    if (pref) {
      await supabase.update("user_preferences", pref.id, {
        ...input.preferences,
        updated_at: new Date().toISOString()
      });
    }
    for (const source of input.sources) {
      const existingSource = await assertSourceConfigBelongsToProject({
        projectId: input.projectId,
        sourceId: source.id
      });
      await supabase.update("source_configs", source.id, { status: sourceStatusForSettings(existingSource, source.status) });
    }
    for (const trigger of input.triggers) {
      await assertTriggerBelongsToProject({
        projectId: input.projectId,
        triggerId: trigger.id
      });
      await supabase.update("triggers", trigger.id, {
        status: trigger.status,
        ...(trigger.config ? { config: trigger.config } : {})
      });
    }
    return;
  }

  await mutateStore((store) => {
    const project = store.projects.find((row) => row.id === input.projectId);
    if (project) {
      project.product_url = input.project.product_url;
      project.description = input.project.description;
      project.updated_at = now;
    }

    const pref = store.user_preferences.find((row) => row.project_id === input.projectId);
    if (pref) {
      pref.preferred_markets = input.preferences.preferred_markets;
      pref.risk_tolerance = input.preferences.risk_tolerance;
      pref.notes = input.preferences.notes;
    }
    for (const source of input.sources) {
      const row = store.source_configs.find((entry) => entry.id === source.id);
      if (!row || !projectChildBelongsToProject(row, input.projectId)) {
        throw new Error("Source config does not belong to this project.");
      }
      row.status = sourceStatusForSettings(row, source.status);
    }
    for (const trigger of input.triggers) {
      const row = store.triggers.find((entry) => entry.id === trigger.id);
      if (!row || !projectChildBelongsToProject(row, input.projectId)) {
        throw new Error("Trigger does not belong to this project.");
      }
      row.status = trigger.status;
      if (trigger.config) {
        row.config = { ...(row.config ?? {}), ...trigger.config };
      }
    }
  });
}

export async function markTriggerRan(input: { projectId: string; triggerId: string }): Promise<void> {
  await assertTriggerBelongsToProject(input);

  const patch = { last_run_at: new Date().toISOString() };

  if (isSupabaseConfigured()) {
    const supabase = createSupabaseClient()!;
    await supabase.update("triggers", input.triggerId, patch);
    return;
  }

  await mutateStore((store) => {
    const trigger = store.triggers.find((row) => row.id === input.triggerId);
    if (trigger && projectChildBelongsToProject(trigger, input.projectId)) {
      trigger.last_run_at = patch.last_run_at;
    }
  });
}

export async function archiveProjectRecord(projectId: string): Promise<void> {
  await assertProjectAccessible(projectId);

  const now = new Date().toISOString();

  if (isSupabaseConfigured()) {
    const supabase = createSupabaseClient()!;
    await supabase.update("projects", projectId, {
      archived_at: now,
      stage: "archived",
      updated_at: now
    });
    return;
  }

  await mutateStore((store) => {
    const project = store.projects.find((row) => row.id === projectId);
    if (!project) {
      return;
    }
    project.archived_at = now;
    project.stage = "archived";
    project.updated_at = now;
    for (const trigger of store.triggers.filter((row) => row.project_id === projectId)) {
      trigger.status = "disabled";
    }
    store.preference_events.unshift({
      id: newId("evt"),
      project_id: projectId,
      event_type: "project_archived",
      payload: { archived_at: now },
      created_at: now
    });
  });
}

export async function resolveReflectionProposal(input: {
  projectId: string;
  proposalId: string;
  decision: "accepted" | "rejected";
}): Promise<void> {
  await assertReflectionProposalBelongsToProject({
    projectId: input.projectId,
    proposalId: input.proposalId
  });

  const patch = { status: input.decision, updated_at: new Date().toISOString() };

  if (isSupabaseConfigured()) {
    const supabase = createSupabaseClient()!;
    await supabase.update("reflection_proposals", input.proposalId, patch);
    return;
  }

  await mutateStore((store) => {
    const proposal = store.reflection_proposals.find((row) => row.id === input.proposalId);
    if (proposal) {
      proposal.status = input.decision;
    }
  });
}

export async function getProjectBundle(projectId: string, store?: ForgeStore) {
  const data = store ?? (await loadStore());
  const project = data.projects.find((row) => row.id === projectId);
  const identity = await getActiveIdentity();

  if (!project || !projectVisibleToIdentity(project, identity)) {
    return emptyProjectBundle();
  }

  const projectOpportunities = data.opportunities.filter((row) => row.project_id === projectId);
  const projectOpportunityIds = new Set(projectOpportunities.map((opportunity) => opportunity.id));
  const projectSignals = data.signals.filter((row) => row.project_id === projectId);
  const projectSignalIds = new Set(projectSignals.map((signal) => signal.id));
  const projectBuilds = data.mvp_builds.filter((row) => row.project_id === projectId);
  const projectBuildIds = new Set(projectBuilds.map((build) => build.id));

  return {
    project,
    sources: data.source_configs.filter((row) => row.project_id === projectId),
    githubConnections: data.github_connections.filter((row) =>
      githubConnectionVisibleToProject({
        projectId,
        project,
        connection: row,
        sources: data.source_configs
      })
    ),
    triggers: data.triggers.filter((row) => row.project_id === projectId),
    preferences: data.user_preferences.find((row) => row.project_id === projectId),
    runs: data.pipeline_runs.filter((row) => row.project_id === projectId),
    conversations: data.idea_conversations.filter((row) => row.project_id === projectId),
    messages: data.idea_messages.filter((message) =>
      data.idea_conversations.some((conversation) => conversation.project_id === projectId && conversation.id === message.conversation_id)
    ),
    researchBriefs: data.research_briefs.filter((row) => row.project_id === projectId),
    agentTasks: data.agent_tasks.filter((row) => row.project_id === projectId),
    opportunities: projectOpportunities,
    signals: projectSignals,
    links: data.opportunity_signals.filter(
      (link) => projectOpportunityIds.has(link.opportunity_id) && projectSignalIds.has(link.signal_id)
    ),
    evaluations: data.opportunity_evaluations.filter((evaluation) =>
      projectOpportunityIds.has(evaluation.opportunity_id ?? "")
    ),
    prototypes: data.prototype_options.filter((row) => row.project_id === projectId),
    builds: projectBuilds,
    artifacts: data.build_artifacts.filter((artifact) => projectBuildIds.has(artifact.mvp_build_id)),
    reflectionRuns: data.reflection_runs.filter((row) => row.project_id === projectId),
    reflectionProposals: data.reflection_proposals.filter((proposal) =>
      data.reflection_runs.some((run) => run.project_id === projectId && run.id === proposal.reflection_run_id)
    ),
    preferenceEvents: data.preference_events.filter((row) => row.project_id === projectId)
  };
}

function emptyProjectBundle() {
  return {
    project: undefined,
    sources: [],
    githubConnections: [],
    triggers: [],
    preferences: undefined,
    runs: [],
    conversations: [],
    messages: [],
    researchBriefs: [],
    agentTasks: [],
    opportunities: [],
    signals: [],
    links: [],
    evaluations: [],
    prototypes: [],
    builds: [],
    artifacts: [],
    reflectionRuns: [],
    reflectionProposals: [],
    preferenceEvents: []
  };
}


export async function getOpportunityRecord(
  projectId: string,
  opportunityId: string,
  store?: ForgeStore
): Promise<DbOpportunity | undefined> {
  const data = store ?? (await loadStore());
  const bundle = await getProjectBundle(projectId, data);
  return bundle.opportunities.find((row) => row.id === opportunityId);
}

export async function getForgeSettingsView() {
  const store = await loadStore();
  const identity = await getActiveIdentity();
  const visibleProjectIds = new Set(
    store.projects
      .filter((project) => projectVisibleToIdentity(project, identity))
      .map((project) => project.id)
  );
  const visibleReflectionRunIds = new Set(
    store.reflection_runs
      .filter((run) => run.project_id && visibleProjectIds.has(run.project_id))
      .map((run) => run.id)
  );
  const proposals = store.reflection_proposals.filter(
    (row) => row.status === "proposed" && visibleReflectionRunIds.has(row.reflection_run_id)
  );

  return {
    builder:
      process.env.FORGE_BUILDER_ADAPTER === "managed" || process.env.GEMINI_API_KEY
        ? "Gemini managed builder"
        : isSupabaseConfigured()
          ? "Supabase-backed simulated adapter"
          : "Local simulated adapter",
    humanGate: "Opportunity approval required",
    guardrails: ["Free services only", "Template repo", "PR-ready MVP", "No production deploys"],
    reflectionProposals: proposals
  };
}

function cleanOptional(value: string | null | undefined): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}

function summarizeTitle(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > 64 ? `${text.slice(0, 61).trim()}...` : text || "Idea conversation";
}

async function assertProjectAccessible(projectId: string): Promise<void> {
  const identity = await getActiveIdentity();

  if (isSupabaseConfigured()) {
    const supabase = createSupabaseClient()!;
    const project = (
      await supabase.select<DbProject>(
        "projects",
        `select=id,owner_user_id,workspace_id&id=eq.${encodeURIComponent(projectId)}&limit=1`
      )
    )[0];
    if (!project || !projectVisibleToIdentity(project, identity)) {
      throw new Error("Project not found.");
    }
    return;
  }

  const store = await readLocalStore();
  const project = store.projects.find((row) => row.id === projectId);
  if (!project || !projectVisibleToIdentity(project, identity)) {
    throw new Error("Project not found.");
  }
}

async function assertGitHubConnectionUsableForProject(input: {
  projectId: string;
  connectionId: string;
}): Promise<void> {
  const identity = await getActiveIdentity();

  if (isSupabaseConfigured()) {
    const supabase = createSupabaseClient()!;
    const project = (
      await supabase.select<DbProject>(
        "projects",
        `select=id,owner_user_id,workspace_id&id=eq.${encodeURIComponent(input.projectId)}&limit=1`
      )
    )[0];
    const connection = (
      await supabase.select<DbGitHubConnection>(
        "github_connections",
        `select=id,owner_user_id,workspace_id&id=eq.${encodeURIComponent(input.connectionId)}&limit=1`
      )
    )[0];
    const sources = await supabase.select<DbSourceConfig>(
      "source_configs",
      `select=project_id,connection_id&project_id=eq.${encodeURIComponent(input.projectId)}`
    );
    if (
      !githubConnectionUsableForProject({
        projectId: input.projectId,
        project,
        identity,
        connection,
        sources
      })
    ) {
      throw new Error("GitHub connection does not belong to this project.");
    }
    return;
  }

  const store = await readLocalStore();
  const project = store.projects.find((row) => row.id === input.projectId);
  const connection = store.github_connections.find((row) => row.id === input.connectionId);
  const sources = store.source_configs.filter((row) => row.project_id === input.projectId);
  if (
    !githubConnectionUsableForProject({
      projectId: input.projectId,
      project,
      identity,
      connection,
      sources
    })
  ) {
    throw new Error("GitHub connection does not belong to this project.");
  }
}

async function assertOpportunityBelongsToProject(input: {
  projectId: string;
  opportunityId: string;
}): Promise<void> {
  if (isSupabaseConfigured()) {
    const supabase = createSupabaseClient()!;
    const opportunity = (
      await supabase.select<DbOpportunity>(
        "opportunities",
        `select=id,project_id&id=eq.${encodeURIComponent(input.opportunityId)}&limit=1`
      )
    )[0];
    if (!opportunityBelongsToProject(opportunity, input.projectId)) {
      throw new Error("Opportunity does not belong to this project.");
    }
    return;
  }

  const store = await readLocalStore();
  const opportunity = store.opportunities.find((row) => row.id === input.opportunityId);
  if (!opportunityBelongsToProject(opportunity, input.projectId)) {
    throw new Error("Opportunity does not belong to this project.");
  }
}

async function assertMvpBuildBelongsToProject(input: {
  projectId: string;
  buildId: string;
}): Promise<void> {
  if (isSupabaseConfigured()) {
    const supabase = createSupabaseClient()!;
    const build = (
      await supabase.select<DbMvpBuild>(
        "mvp_builds",
        `select=id,project_id&id=eq.${encodeURIComponent(input.buildId)}&limit=1`
      )
    )[0];
    if (!projectChildBelongsToProject(build, input.projectId)) {
      throw new Error("Build does not belong to this project.");
    }
    return;
  }

  const store = await readLocalStore();
  const build = store.mvp_builds.find((row) => row.id === input.buildId);
  if (!projectChildBelongsToProject(build, input.projectId)) {
    throw new Error("Build does not belong to this project.");
  }
}

async function assertMvpBuildBelongsToOpportunity(input: {
  buildId: string;
  opportunityId: string;
}): Promise<void> {
  if (isSupabaseConfigured()) {
    const supabase = createSupabaseClient()!;
    const build = (
      await supabase.select<DbMvpBuild>(
        "mvp_builds",
        `select=id,opportunity_id&id=eq.${encodeURIComponent(input.buildId)}&limit=1`
      )
    )[0];
    if (!build || build.opportunity_id !== input.opportunityId) {
      throw new Error("Build does not belong to this opportunity.");
    }
    return;
  }

  const store = await readLocalStore();
  const build = store.mvp_builds.find((row) => row.id === input.buildId);
  if (!build || build.opportunity_id !== input.opportunityId) {
    throw new Error("Build does not belong to this opportunity.");
  }
}

async function assertPipelineRunBelongsToProject(input: {
  projectId: string;
  runId: string;
}): Promise<void> {
  if (isSupabaseConfigured()) {
    const supabase = createSupabaseClient()!;
    const run = (
      await supabase.select<DbPipelineRun>(
        "pipeline_runs",
        `select=id,project_id&id=eq.${encodeURIComponent(input.runId)}&limit=1`
      )
    )[0];
    if (!projectChildBelongsToProject(run, input.projectId)) {
      throw new Error("Pipeline run does not belong to this project.");
    }
    return;
  }

  const store = await readLocalStore();
  const run = store.pipeline_runs.find((row) => row.id === input.runId);
  if (!projectChildBelongsToProject(run, input.projectId)) {
    throw new Error("Pipeline run does not belong to this project.");
  }
}

async function assertAgentTaskBelongsToProject(input: {
  projectId: string;
  taskId: string;
}): Promise<void> {
  if (isSupabaseConfigured()) {
    const supabase = createSupabaseClient()!;
    const task = (
      await supabase.select<DbAgentTask>(
        "agent_tasks",
        `select=id,project_id&id=eq.${encodeURIComponent(input.taskId)}&limit=1`
      )
    )[0];
    if (!projectChildBelongsToProject(task, input.projectId)) {
      throw new Error("Agent task does not belong to this project.");
    }
    return;
  }

  const store = await readLocalStore();
  const task = store.agent_tasks.find((row) => row.id === input.taskId);
  if (!projectChildBelongsToProject(task, input.projectId)) {
    throw new Error("Agent task does not belong to this project.");
  }
}

async function assertReflectionProposalBelongsToProject(input: {
  projectId: string;
  proposalId: string;
}): Promise<void> {
  if (isSupabaseConfigured()) {
    const supabase = createSupabaseClient()!;
    const proposal = (
      await supabase.select<DbReflectionProposal>(
        "reflection_proposals",
        `select=id,reflection_run_id&id=eq.${encodeURIComponent(input.proposalId)}&limit=1`
      )
    )[0];
    if (!proposal) {
      throw new Error("Reflection proposal does not belong to this project.");
    }
    const run = (
      await supabase.select<DbReflectionRun>(
        "reflection_runs",
        `select=id,project_id&id=eq.${encodeURIComponent(proposal.reflection_run_id)}&limit=1`
      )
    )[0];
    if (!projectChildBelongsToProject(run, input.projectId)) {
      throw new Error("Reflection proposal does not belong to this project.");
    }
    return;
  }

  const store = await readLocalStore();
  const proposal = store.reflection_proposals.find((row) => row.id === input.proposalId);
  const run = proposal
    ? store.reflection_runs.find((row) => row.id === proposal.reflection_run_id)
    : undefined;
  if (!projectChildBelongsToProject(run, input.projectId)) {
    throw new Error("Reflection proposal does not belong to this project.");
  }
}

async function assertConversationBelongsToProject(input: {
  projectId: string;
  conversationId: string;
}): Promise<void> {
  if (isSupabaseConfigured()) {
    const supabase = createSupabaseClient()!;
    const conversation = (
      await supabase.select<DbIdeaConversation>(
        "idea_conversations",
        `select=id,project_id&id=eq.${encodeURIComponent(input.conversationId)}&limit=1`
      )
    )[0];
    if (!conversationBelongsToProject(conversation, input.projectId)) {
      throw new Error("Idea conversation does not belong to this project.");
    }
    return;
  }

  const store = await readLocalStore();
  const conversation = store.idea_conversations.find((row) => row.id === input.conversationId);
  if (!conversationBelongsToProject(conversation, input.projectId)) {
    throw new Error("Idea conversation does not belong to this project.");
  }
}

async function assertResearchBriefBelongsToProject(input: {
  projectId: string;
  briefId: string;
}): Promise<void> {
  if (isSupabaseConfigured()) {
    const supabase = createSupabaseClient()!;
    const brief = (
      await supabase.select<DbResearchBrief>(
        "research_briefs",
        `select=id,project_id&id=eq.${encodeURIComponent(input.briefId)}&limit=1`
      )
    )[0];
    if (!researchBriefBelongsToProject(brief, input.projectId)) {
      throw new Error("Research brief does not belong to this project.");
    }
    return;
  }

  const store = await readLocalStore();
  const brief = store.research_briefs.find((row) => row.id === input.briefId);
  if (!researchBriefBelongsToProject(brief, input.projectId)) {
    throw new Error("Research brief does not belong to this project.");
  }
}

async function assertSourceConfigBelongsToProject(input: {
  projectId: string;
  sourceId: string;
}): Promise<DbSourceConfig> {
  if (isSupabaseConfigured()) {
    const supabase = createSupabaseClient()!;
    const source = (
      await supabase.select<DbSourceConfig>(
        "source_configs",
        `select=id,project_id,source_type,connection_id,config&id=eq.${encodeURIComponent(input.sourceId)}&limit=1`
      )
    )[0];
    if (!source || !projectChildBelongsToProject(source, input.projectId)) {
      throw new Error("Source config does not belong to this project.");
    }
    return source;
  }

  const store = await readLocalStore();
  const source = store.source_configs.find((row) => row.id === input.sourceId);
  if (!source || !projectChildBelongsToProject(source, input.projectId)) {
    throw new Error("Source config does not belong to this project.");
  }
  return source;
}

async function assertTriggerBelongsToProject(input: {
  projectId: string;
  triggerId: string;
}): Promise<void> {
  if (isSupabaseConfigured()) {
    const supabase = createSupabaseClient()!;
    const trigger = (
      await supabase.select<DbTrigger>(
        "triggers",
        `select=id,project_id&id=eq.${encodeURIComponent(input.triggerId)}&limit=1`
      )
    )[0];
    if (!projectChildBelongsToProject(trigger, input.projectId)) {
      throw new Error("Trigger does not belong to this project.");
    }
    return;
  }

  const store = await readLocalStore();
  const trigger = store.triggers.find((row) => row.id === input.triggerId);
  if (!projectChildBelongsToProject(trigger, input.projectId)) {
    throw new Error("Trigger does not belong to this project.");
  }
}
