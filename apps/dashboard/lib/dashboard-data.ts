import { loadForgeProject, loadForgeProjects } from "@/lib/forge-data";
import { getActiveIdentity, getProjectBundle, loadStore } from "@/lib/db/repository";
import { getRequestAuthContext } from "@/lib/auth/request-session";
import { isHostedAuthRequired, isSupabaseAuthConfigured } from "@/lib/auth/supabase-auth";
import { GENERATED_REPO_TARGET_SOURCE_TYPE } from "@/lib/build/github-target";
import { projectVisibleToIdentity } from "@/lib/db/identity-scope";
import { emailAllowlistConfigured } from "@/lib/auth/email-allowlist";
import {
  githubAppInstallUrl,
  githubUserAuthorizationUrl,
  isGitHubAppConfigured,
  isGitHubDevelopmentFallbackEnabled,
  isGitHubUserOAuthConfigured
} from "@/lib/github/github-app";
import { buildOnboardingChecklist, onboardingStatus, sourceStatusForSettings } from "@/lib/project-onboarding";
import { runtimeReadiness } from "@/lib/runtime/readiness";
import { isDueProjectTrigger } from "@/lib/scheduler/demo-scheduler";
import type { DbPipelineRun, JsonObject } from "@/lib/db/types";
import type {
  AuthSessionView,
  AccountSettingsView,
  IdeaConversationView,
  MorningReviewProject,
  ResearchEvidenceSummaryView,
  ProjectSettingsView,
  SchedulerOverview
} from "@/types/forge";

export async function loadDashboardProjects() {
  return loadForgeProjects();
}

export async function loadAuthSessionView(): Promise<AuthSessionView> {
  const requestAuth = await getRequestAuthContext();
  if (!requestAuth && isHostedAuthRequired()) {
    return {
      mode: "local_default",
      label: "Email account required",
      detail: "Hosted dashboard access requires a Forge email account.",
      signedIn: false,
      signInConfigured: isSupabaseAuthConfigured()
    };
  }
  const identity = await getActiveIdentity();
  if (requestAuth) {
    return {
      mode: "hosted_session",
      label: requestAuth.email || "Signed-in user",
      detail: `Workspace ${identity.workspaceId}`,
      signedIn: true,
      signInConfigured: isSupabaseAuthConfigured()
    };
  }
  const hasEnvOverride = Boolean(process.env.FORGE_USER_ID || process.env.FORGE_AUTH_SUBJECT);
  return {
    mode: hasEnvOverride ? "env_override" : "local_default",
    label: hasEnvOverride ? identity.userId : "Local workspace",
    detail: hasEnvOverride
      ? `Using server identity override for ${identity.workspaceId}`
      : "Using local development identity",
    signedIn: false,
    signInConfigured: isSupabaseAuthConfigured()
  };
}

export async function loadAccountSettingsView(): Promise<AccountSettingsView> {
  const [authSession, identity, store] = await Promise.all([
    loadAuthSessionView(),
    getActiveIdentity(),
    loadStore()
  ]);
  const visibleProjects = store.projects.filter((project) => projectVisibleToIdentity(project, identity));
  const visibleProjectIds = new Set(visibleProjects.map((project) => project.id));
  const sourceConnectionIds = new Set(
    store.source_configs
      .filter((source) => visibleProjectIds.has(source.project_id))
      .map((source) => source.connection_id)
      .filter((value): value is string => Boolean(value))
  );
  const githubConnections = store.github_connections.filter((connection) => {
    if (connection.owner_user_id === identity.userId) return true;
    if (connection.workspace_id === identity.workspaceId) return true;
    return sourceConnectionIds.has(connection.id);
  });

  return {
    authSession,
    identity: {
      userId: identity.userId,
      workspaceId: identity.workspaceId,
      authProvider: identity.authProvider ?? "local",
      authSubject: identity.authSubject ?? identity.userId,
      email: identity.email ?? null
    },
    emailAllowlistEnabled: emailAllowlistConfigured(),
    projectLinks: visibleProjects.map((project) => ({
      id: project.id,
      name: project.name,
      mode: project.mode
    })),
    githubConnections: githubConnections.map((connection) => ({
      id: connection.id,
      accountLogin: connection.account_login,
      accountType: connection.account_type,
      provider: connection.provider,
      status: connection.status,
      installationId: connection.installation_id,
      scopes: connection.scopes ?? []
    }))
  };
}

export async function loadSchedulerOverview(projectId?: string): Promise<SchedulerOverview> {
  const store = await loadStore();
  const identity = await getActiveIdentity();
  const visibleProjectIds = new Set(
    store.projects.filter((project) => projectVisibleToIdentity(project, identity)).map((project) => project.id)
  );
  const scheduleTriggers = store.triggers.filter(
    (trigger) =>
      trigger.trigger_type !== "manual" &&
      visibleProjectIds.has(trigger.project_id) &&
      (!projectId || trigger.project_id === projectId)
  );
  const active = scheduleTriggers.filter((trigger) => trigger.status === "active");
  const due = active.filter((trigger) => isDueProjectTrigger(trigger));
  const lastRunAt = scheduleTriggers
    .map((trigger) => trigger.last_run_at)
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];

  return {
    activeCount: active.length,
    dueCount: due.length,
    lastRunAt
  };
}

export async function loadDashboardProject(projectId: string) {
  return loadForgeProject(projectId);
}

export async function loadIdeaConversation(projectId: string): Promise<IdeaConversationView | null> {
  const bundle = await getProjectBundle(projectId);
  if (!bundle.project) {
    return null;
  }

  const conversation = [...bundle.conversations].sort((a, b) => time(b.updated_at) - time(a.updated_at))[0];
  if (!conversation) {
    return null;
  }

  const latestBrief = [...bundle.researchBriefs]
    .filter((brief) => brief.conversation_id === conversation.id)
    .sort((a, b) => time(b.updated_at) - time(a.updated_at))[0];
  const latestResearchRun = latestBrief
    ? [...bundle.runs]
        .filter((run) => run.research_brief_id === latestBrief.id)
        .sort((a, b) => time(b.started_at) - time(a.started_at))[0]
    : undefined;

  return {
    id: conversation.id,
    title: conversation.title,
    status: conversation.status,
    messages: bundle.messages
      .filter((message) => message.conversation_id === conversation.id)
      .sort((a, b) => time(a.created_at) - time(b.created_at))
      .map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content
      })),
    latestBrief: latestBrief
      ? {
          id: latestBrief.id,
          status: latestBrief.status,
          hypothesis: latestBrief.hypothesis,
          targetUsers: latestBrief.target_users,
          painArea: latestBrief.pain_area,
          constraints: latestBrief.constraints,
          sourcePlan: latestBrief.source_plan,
          disqualifyingEvidence: latestBrief.disqualifying_evidence,
          mvpBoundaries: latestBrief.mvp_boundaries,
          userTasteNotes: latestBrief.user_taste_notes,
          openQuestions: latestBrief.open_questions,
          confidence: latestBrief.confidence
      }
      : undefined,
    latestResearchRun: latestResearchRun
      ? {
          id: latestResearchRun.id,
          status: latestResearchRun.status,
          evidenceSummary: mapResearchEvidenceSummary(latestResearchRun)
        }
      : undefined,
    agentTasks: bundle.agentTasks
      .filter((task) => !latestBrief || task.research_brief_id === latestBrief.id)
      .map((task) => ({
        id: task.id,
        pipelineRunId: task.pipeline_run_id,
        role: task.agent_role,
        phase: taskPhase(task.agent_role),
        status: task.status,
        detail: taskDetail(task.result, task.error),
        stateLabel: taskStateLabel(task.result, task.status)
      }))
  };
}

export async function loadDashboardOpportunity(projectId: string, opportunityId: string) {
  const project = await loadDashboardProject(projectId);
  if (!project) {
    return null;
  }
  const opportunity = project.opportunities.find((entry) => entry.id === opportunityId);
  return opportunity ? { project, opportunity } : null;
}

export async function loadProjectSettings(projectId: string): Promise<ProjectSettingsView | null> {
  const bundle = await getProjectBundle(projectId);
  if (!bundle.project) {
    return null;
  }
  const checklist = buildOnboardingChecklist({
    project: bundle.project,
    sources: bundle.sources,
    triggers: bundle.triggers,
    preference: bundle.preferences
  });

  return {
    project: {
      repoUrl: bundle.project.repo_url || "",
      productUrl: bundle.project.product_url || "",
      description: bundle.project.description || ""
    },
    onboarding: {
      status: onboardingStatus(checklist),
      checklist
    },
    sources: bundle.sources.map((source) => {
      const requiresConnection =
        source.source_type === "github" && !source.connection_id && objectValue(source.config)?.needs_connection === true;
      return {
        id: source.id,
        name: source.name,
        type: source.source_type,
        displayType: sourceDisplayType(source.source_type),
        status: sourceStatusForSettings(source, source.status),
        requiresConnection
      };
    }),
    githubConnections: bundle.githubConnections.map((connection) => ({
      id: connection.id,
      accountLogin: connection.account_login,
      accountType: connection.account_type,
      provider: connection.provider,
      status: connection.status,
      installationId: connection.installation_id,
      scopes: connection.scopes ?? []
    })),
    githubInstallUrl: githubAppInstallUrl(projectId),
    githubUserAuthUrl: githubUserAuthorizationUrl(projectId),
    githubAppConfigured: isGitHubAppConfigured(),
    githubOAuthConfigured: isGitHubUserOAuthConfigured(),
    githubDevFallbackEnabled: isGitHubDevelopmentFallbackEnabled(),
    runtimeReadiness: runtimeReadiness(),
    triggers: bundle.triggers.map((trigger) => ({
      id: trigger.id,
      name: trigger.name,
      type: trigger.trigger_type,
      status: trigger.status,
      lastRunAt: trigger.last_run_at,
      cadence: stringConfig(trigger.config, "cadence"),
      intervalHours: numberConfig(trigger.config, "interval_hours"),
      timezone: stringConfig(trigger.config, "timezone")
    })),
    preferences: {
      riskTolerance: bundle.preferences?.risk_tolerance || "medium",
      markets: bundle.preferences?.preferred_markets || [],
      notes: bundle.preferences?.notes || ""
    }
  };
}

function stringConfig(config: unknown, key: string): string | null {
  if (!config || typeof config !== "object") return null;
  const value = (config as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

function numberConfig(config: unknown, key: string): number | null {
  if (!config || typeof config !== "object") return null;
  const value = (config as Record<string, unknown>)[key];
  return typeof value === "number" ? value : null;
}

function sourceDisplayType(sourceType: string): string {
  if (sourceType === GENERATED_REPO_TARGET_SOURCE_TYPE) {
    return "Generated repo target";
  }
  if (sourceType === "github") {
    return "GitHub";
  }
  if (sourceType === "reddit") {
    return "Reddit";
  }
  if (sourceType === "hacker_news") {
    return "Hacker News";
  }
  if (sourceType === "stack_exchange") {
    return "Stack Exchange";
  }
  return sourceType.replace(/_/g, " ");
}

function mapResearchEvidenceSummary(run: DbPipelineRun): ResearchEvidenceSummaryView | undefined {
  const metadata = objectValue(run.metadata);
  const managedResearch = objectValue(metadata?.managed_research);
  const summary = objectValue(managedResearch?.evidence_summary) ?? objectValue(metadata?.evidence_summary);
  if (!summary) {
    return undefined;
  }

  const opportunities = numberValue(summary.opportunities) ?? 0;
  const buildReadyOpportunities = numberValue(summary.build_ready_opportunities) ?? 0;
  const needsMoreEvidenceOpportunities = numberValue(summary.needs_more_evidence_opportunities) ?? 0;
  const reasons = stringArray(summary.reasons).slice(0, 3);
  const status =
    opportunities === 0 ? "unknown" : buildReadyOpportunities > 0 ? "ready" : "needs_more_evidence";

  return {
    opportunities,
    buildReadyOpportunities,
    needsMoreEvidenceOpportunities,
    reasons,
    sourceAudit: researchSourceAudit(managedResearch),
    status,
    label: researchEvidenceLabel({ opportunities, buildReadyOpportunities }),
    detail: researchEvidenceDetail({ opportunities, buildReadyOpportunities, needsMoreEvidenceOpportunities, reasons })
  };
}

function researchSourceAudit(managedResearch: JsonObject | null): ResearchEvidenceSummaryView["sourceAudit"] {
  if (!managedResearch) return undefined;
  const sourceRows = Array.isArray(managedResearch.media_sources)
    ? managedResearch.media_sources
        .map((entry) => objectValue(entry))
        .filter((entry): entry is JsonObject => Boolean(entry))
        .map((entry) => {
          const source = typeof entry.source === "string" ? entry.source : "unknown";
          return {
            source,
            label: sourceDisplayType(source),
            count: numberValue(entry.count) ?? 0
          };
        })
        .filter((entry) => entry.count > 0)
    : [];
  const routing = objectValue(managedResearch.source_plan_routing);
  const enabledSources = stringArray(routing?.enabled_sources).map(sourceDisplayType);
  const targets = [
    ...stringArray(routing?.reddit_subreddits).map((item) => `r/${item.replace(/^r\//, "")}`),
    ...stringArray(routing?.stack_exchange_sites).map(sourceDisplayType)
  ];
  if (!sourceRows.length && !enabledSources.length && !targets.length) {
    return undefined;
  }
  return {
    sources: sourceRows,
    enabledSources,
    targets
  };
}

function researchEvidenceLabel(input: { opportunities: number; buildReadyOpportunities: number }): string {
  if (input.opportunities === 0) {
    return "No candidates yet";
  }
  if (input.buildReadyOpportunities > 0) {
    return `${input.buildReadyOpportunities}/${input.opportunities} build-ready`;
  }
  return "More evidence needed";
}

function researchEvidenceDetail(input: {
  opportunities: number;
  buildReadyOpportunities: number;
  needsMoreEvidenceOpportunities: number;
  reasons: string[];
}): string {
  if (input.reasons[0]) {
    return input.reasons[0];
  }
  if (input.opportunities === 0) {
    return "Research has not produced candidate evidence yet.";
  }
  if (input.buildReadyOpportunities > 0) {
    return "At least one candidate has enough public evidence to review for prototyping.";
  }
  return `${input.needsMoreEvidenceOpportunities || input.opportunities} candidate${
    (input.needsMoreEvidenceOpportunities || input.opportunities) === 1 ? "" : "s"
  } need more cited public evidence before build.`;
}

function taskDetail(result: unknown, error: string | null | undefined): string | null {
  if (error) return error;
  if (!result || typeof result !== "object") return null;
  const summary = (result as Record<string, unknown>).summary;
  if (typeof summary === "string" && summary.trim()) {
    return summary.trim();
  }
  const status = (result as Record<string, unknown>).status;
  if (typeof status === "string" && status.trim()) {
    return status.replace(/_/g, " ");
  }
  return null;
}

function taskStateLabel(result: unknown, status: string): string {
  if (status === "completed") return "Done";
  if (status === "failed") return "Failed";
  if (!result || typeof result !== "object") return status.replace(/_/g, " ");
  const resultStatus = (result as Record<string, unknown>).status;
  if (resultStatus === "waiting_for_managed_research_backend") return "Needs backend";
  if (resultStatus === "waiting_for_evaluation") return "Needs eval";
  if (typeof resultStatus === "string" && resultStatus.trim()) {
    return resultStatus.replace(/_/g, " ");
  }
  return status.replace(/_/g, " ");
}

function taskPhase(role: string): string {
  if (role === "SourceCollector") return "Source collection";
  if (role === "Researcher") return "Market research";
  if (role === "TasteCritic") return "Taste critique";
  if (role === "BullAgent" || role === "BearAgent") return "Bull/Bear review";
  if (role === "DecisionAgent") return "Decision";
  if (role === "Synthesizer") return "Build direction";
  return "Research";
}

function objectValue(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
}

export async function loadDashboardProjectWithMeta(projectId: string): Promise<MorningReviewProject | null> {
  return loadForgeProject(projectId);
}

function time(value: string | null | undefined): number {
  return value ? new Date(value).getTime() : 0;
}
