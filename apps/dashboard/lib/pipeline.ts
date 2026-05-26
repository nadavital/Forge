import {
  completePipelineRun,
  createAgentTasks,
  createPipelineRun,
  failPipelineRun,
  getProjectWorkerIdentity,
  getProjectBundle,
  loadQueuedResearchPipelineRunsForWorker,
  replaceProjectDiscoveryRecords,
  updateAgentTasks,
  updatePipelineRunStatus,
  updateResearchBriefStatus,
  updateProjectRepository,
  withActiveIdentity
} from "@/lib/db/repository";
import { discoverGitHubRepo } from "@/lib/github/repo-discovery";
import { connectedRepoDiscoveryRequiresConnection } from "@/lib/github/repo-connection-policy";
import { discoverNewProductIdeas } from "@/lib/ideas/new-product-discovery";
import { latestApprovedResearchBrief, researchBriefCanRun } from "@/lib/ideas/research-brief-approval";
import { taskUpdatesForResearch } from "@/lib/research/agent-task-updates";
import { runManagedBriefResearch } from "@/lib/research/managed-research-client";
import {
  MANAGED_RESEARCH_BACKEND_REQUIRED_MESSAGE,
  assertManagedBriefResearchReady
} from "@/lib/research/managed-research-policy";
import { runReflection } from "@/lib/reflection/reflection-engine";
import { rankOpportunitiesWithPreferences } from "@/lib/scoring/preference-ranking";
import type { DbAgentTask, DbPipelineRun, DbProject, DbResearchBrief, DbSourceConfig, DbUserPreference, JsonObject } from "@/lib/db/types";

const BRIEF_AGENT_ROLES = [
  "SourceCollector",
  "Researcher",
  "TasteCritic",
  "BullAgent",
  "BearAgent",
  "DecisionAgent",
  "Synthesizer"
];
const DEFAULT_WORKER_SWEEP_LIMIT = 5;
const MAX_WORKER_SWEEP_LIMIT = 10;

export async function triggerProjectPipeline(
  projectId: string,
  options: { researchBriefId?: string } = {}
): Promise<{ runId: string; message: string }> {
  const bundle = await getProjectBundle(projectId);
  if (!bundle.project) {
    throw new Error("Project not found.");
  }
  const reflection = await runReflection({ projectId });
  const run = await createPipelineRun(projectId, { researchBriefId: options.researchBriefId });
  const githubSourceConfig = githubSource(bundle.sources);
  const repoUrl = bundle.project?.repo_url || githubSourceConfig?.repoUrl || "";
  const githubConnection = githubSourceConfig?.connectionId
    ? bundle.githubConnections.find((connection) => connection.id === githubSourceConfig.connectionId)
    : undefined;
  const researchBrief = options.researchBriefId
    ? bundle.researchBriefs.find((brief) => brief.id === options.researchBriefId)
    : latestApprovedResearchBrief(bundle.researchBriefs);
  const reflectionLine = `Reflected on prior decisions and generated ${reflection.proposalCount} self-improvement proposal${reflection.proposalCount === 1 ? "" : "s"}`;

  if (repoUrl) {
    if (connectedRepoDiscoveryRequiresConnection({ repoUrl, connection: githubConnection })) {
      const message =
        "Connect this repository with a GitHub App installation before running hosted connected-product research.";
      await failPipelineRun(projectId, run.id, {
        source: "github",
        repo_url: repoUrl,
        digest_summary: "Connected-product research is waiting for a scoped GitHub connection.",
        error: message,
        missing: ["github_connection"],
        changes: [
          reflectionLine,
          "Skipped public GitHub discovery because hosted mode requires a project-linked GitHub connection.",
          "Use the GitHub connection panel to install the GitHub App, then link the repository."
        ],
        reflection_proposal_count: reflection.proposalCount,
        reflection_run_ids: reflection.runIds
      });
      return {
        runId: run.id,
        message
      };
    }
    try {
      const discovery = await discoverGitHubRepo(repoUrl, { connection: githubConnection });
      await updateProjectRepository({
        projectId,
        repoUrl: discovery.repoUrl,
        productContext: discovery.productContext
      });
      await replaceProjectDiscoveryRecords({
        projectId,
        runId: run.id,
        signals: discovery.signals,
        opportunities: rankOpportunitiesWithPreferences({
          opportunities: discovery.opportunities,
          existingOpportunities: bundle.opportunities,
          preferenceEvents: bundle.preferenceEvents,
          preferences: bundle.preferences
        })
      });

      await completePipelineRun(projectId, run.id, {
        source: "github",
        repo_url: discovery.repoUrl,
        digest_summary:
          discovery.opportunities.length > 0
            ? `Analyzed ${discovery.projectName} with semantic discovery and produced ${discovery.opportunities.length} evidence-backed opportunities.`
            : `Analyzed ${discovery.projectName}. Forge collected project memory; recommendations are pending semantic discovery evidence.`,
        changes: [
          reflectionLine,
          `Collected ${discovery.signals.length} GitHub repo signals`,
          discovery.opportunities.length > 0
            ? `Ranked ${discovery.opportunities.length} model-generated opportunities with repository evidence`
            : "No recommendation cards were created without model-backed product reasoning",
          discovery.opportunities.length > 0
            ? "Build briefs will target the connected repository"
            : "Project memory is available; rerun Dream when semantic discovery is configured or evidence improves"
        ],
        reflection_proposal_count: reflection.proposalCount,
        reflection_run_ids: reflection.runIds,
        project_knowledge: discovery.knowledge,
        repo_analysis: discovery.analysis
      });

      return {
        runId: run.id,
        message:
          discovery.opportunities.length > 0
            ? `Pipeline run completed for ${discovery.projectName}. Refresh to review repo-specific ideas.`
            : `Pipeline run completed for ${discovery.projectName}. Forge collected memory but did not create non-agentic recommendations.`
      };
    } catch (error) {
      await failPipelineRun(projectId, run.id, {
        source: "github",
        repo_url: repoUrl,
        digest_summary: "Dream failed before semantic recommendations were created.",
        error: error instanceof Error ? error.message : String(error),
        reflection_proposal_count: reflection.proposalCount,
        reflection_run_ids: reflection.runIds
      });
      throw error;
    }
  }

  if (researchBrief) {
    if (!researchBriefCanRun(researchBrief)) {
      await failPipelineRun(projectId, run.id, {
        source: "research_brief",
        research_brief_id: researchBrief.id,
        digest_summary: "Brief research was blocked because the direction has not been approved.",
        error: "Research brief must be approved before research agents run.",
        reflection_proposal_count: reflection.proposalCount,
        reflection_run_ids: reflection.runIds
      });
      throw new Error("Research brief must be approved before research agents run.");
    }
    let tasks: Array<{ id: string; agent_role: string }> = [];
    try {
      await updateResearchBriefStatus({
        projectId,
        briefId: researchBrief.id,
        status: "running"
      });
      tasks = await createAgentTasks(
        BRIEF_AGENT_ROLES.map((role) => ({
          project_id: projectId,
          pipeline_run_id: run.id,
          research_brief_id: researchBrief.id,
          agent_role: role,
          prompt: agentPromptForBrief(role, researchBrief)
        }))
      );
      assertManagedBriefResearchReady();
      const managedDiscovery = await runManagedBriefResearch({
        project: bundle.project,
        preferences: bundle.preferences,
        researchBrief,
        sources: bundle.sources,
        githubConnections: bundle.githubConnections
      });
      const discovery = managedDiscovery ?? discoverNewProductIdeas({
        projectName: bundle.project?.name ?? "New product",
        preferences: bundle.preferences,
        researchBrief
      });
      const taskUpdates = taskUpdatesForResearch(tasks, managedDiscovery?.metadata);
      await updateAgentTasks(projectId, taskUpdates);
      await replaceProjectDiscoveryRecords({
        projectId,
        runId: run.id,
        signals: discovery.signals,
        opportunities: rankOpportunitiesWithPreferences({
          opportunities: discovery.opportunities,
          existingOpportunities: bundle.opportunities,
          preferenceEvents: bundle.preferenceEvents,
          preferences: bundle.preferences
        })
      });
      await updateResearchBriefStatus({
        projectId,
        briefId: researchBrief.id,
        status: "completed"
      });

      await completePipelineRun(projectId, run.id, {
        source: "research_brief",
        research_brief_id: researchBrief.id,
        managed_research: managedDiscovery?.metadata ?? { status: "not_configured" },
        digest_summary: researchBriefDigestSummary(discovery.opportunities.length, managedDiscovery?.metadata),
        changes: [
          reflectionLine,
          `Compiled approved brief: ${researchBrief.hypothesis}`,
          `Queued ${tasks.length} agent task${tasks.length === 1 ? "" : "s"} from the brief`,
          managedDiscovery
            ? `Managed research collected ${discovery.signals.length} source signal${discovery.signals.length === 1 ? "" : "s"}`
            : "Managed research backend is not configured; retained brief-origin hypothesis records",
          researchBriefOpportunityChange(discovery.opportunities.length, managedDiscovery?.metadata, Boolean(managedDiscovery))
        ],
        reflection_proposal_count: reflection.proposalCount,
        reflection_run_ids: reflection.runIds,
        research_brief: researchBrief,
        agent_tasks: tasks.map((task) => ({
          id: task.id,
          role: task.agent_role,
          status: taskUpdates.find((update) => update.id === task.id)?.status ?? "queued",
          result: taskUpdates.find((update) => update.id === task.id)?.result ?? null
        }))
      });

      return {
        runId: run.id,
        message:
          discovery.opportunities.length > 0
            ? "Research run started from the approved brief. Refresh to review the first hypothesis cards."
            : "Research run queued from the approved brief. Connect the managed research backend to collect source evidence."
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await updateAgentTasks(
        projectId,
        failedTaskUpdates(tasks, errorMessage)
      );
      await updateResearchBriefStatus({
        projectId,
        briefId: researchBrief.id,
        status: "approved"
      });
      await failPipelineRun(projectId, run.id, {
        source: "research_brief",
        research_brief_id: researchBrief.id,
        digest_summary: researchBriefFailureSummary(errorMessage),
        error: errorMessage,
        ...managedResearchMissingMetadata(errorMessage),
        reflection_proposal_count: reflection.proposalCount,
        reflection_run_ids: reflection.runIds
      });
      throw error;
    }
  }

  await completePipelineRun(projectId, run.id, {
    source: "new_product_waiting_for_brief",
    digest_summary: "New-product discovery is waiting for an approved AI research brief.",
    changes: [
      reflectionLine,
      "No repository or approved research brief is attached to this project yet.",
      "Skipped local context replacement so existing source-backed opportunities stay intact.",
      "Use the AI idea conversation to compile and approve a research brief before agents run."
    ],
    reflection_proposal_count: reflection.proposalCount,
    reflection_run_ids: reflection.runIds
  });

  return {
    runId: run.id,
    message: "Start the AI idea conversation and approve a research brief before running new-product research."
  };
}

export async function queueResearchBriefPipeline(
  projectId: string,
  researchBriefId: string
): Promise<{ runId: string; taskCount: number; message: string }> {
  const bundle = await getProjectBundle(projectId);
  if (!bundle.project) {
    throw new Error("Project not found.");
  }
  const researchBrief = bundle.researchBriefs.find((brief) => brief.id === researchBriefId);
  if (!researchBrief || !researchBriefCanRun(researchBrief)) {
    throw new Error("Research brief must be approved before research agents run.");
  }
  assertManagedBriefResearchReady();

  let run: DbPipelineRun | null = null;
  let tasks: DbAgentTask[] = [];
  try {
    await updateResearchBriefStatus({
      projectId,
      briefId: researchBrief.id,
      status: "running"
    });
    run = await createPipelineRun(projectId, {
      researchBriefId,
      status: "queued",
      metadata: {
        source: "research_brief",
        research_brief_id: researchBriefId,
        queued_for: "pipeline_worker"
      }
    });
    tasks = await createBriefAgentTasks({
      projectId,
      runId: run.id,
      researchBrief
    });
  } catch (error) {
    if (run) {
      await failPipelineRun(projectId, run.id, {
        source: "research_brief",
        research_brief_id: researchBrief.id,
        digest_summary: "Brief research could not be queued for the worker.",
        error: error instanceof Error ? error.message : String(error)
      });
    }
    await updateResearchBriefStatus({
      projectId,
      briefId: researchBrief.id,
      status: "approved"
    });
    throw error;
  }

  return {
    runId: run.id,
    taskCount: tasks.length,
    message: `Research agents queued for "${researchBrief.hypothesis}".`
  };
}

export async function processQueuedPipelineRun(input: {
  projectId: string;
  runId: string;
}): Promise<{ runId: string; status: "completed" | "failed" | "skipped"; message: string }> {
  const identity = await getProjectWorkerIdentity(input.projectId);
  return withActiveIdentity(identity, () => processQueuedPipelineRunForActiveScope(input));
}

async function processQueuedPipelineRunForActiveScope(input: {
  projectId: string;
  runId: string;
}): Promise<{ runId: string; status: "completed" | "failed" | "skipped"; message: string }> {
  const bundle = await getProjectBundle(input.projectId);
  if (!bundle.project) {
    throw new Error("Project not found.");
  }
  const run = bundle.runs.find((row) => row.id === input.runId);
  if (!run) {
    throw new Error("Pipeline run not found.");
  }
  if (run.status === "completed" || run.status === "failed") {
    return {
      runId: run.id,
      status: "skipped",
      message: `Pipeline run is already ${run.status}.`
    };
  }
  if (!run.research_brief_id) {
    throw new Error("Queued worker currently supports research-brief runs only.");
  }
  const researchBrief = bundle.researchBriefs.find((brief) => brief.id === run.research_brief_id);
  if (!researchBrief) {
    throw new Error("Research brief not found.");
  }

  try {
    await updatePipelineRunStatus(input.projectId, run.id, {
      status: "running",
      metadata: {
        ...(run.metadata ?? {}),
        worker_started_at: new Date().toISOString()
      }
    });
    await executeResearchBriefPipelineRun({
      projectId: input.projectId,
      project: bundle.project,
      preferences: bundle.preferences,
      sources: bundle.sources,
      githubConnections: bundle.githubConnections,
      existingOpportunities: bundle.opportunities,
      preferenceEvents: bundle.preferenceEvents,
      run,
      researchBrief,
      tasks: bundle.agentTasks.filter((task) => task.pipeline_run_id === run.id)
    });
    return {
      runId: run.id,
      status: "completed",
      message: "Queued research run completed."
    };
  } catch (error) {
    return {
      runId: run.id,
      status: "failed",
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function processQueuedPipelineRuns(input: {
  projectId?: string;
  limit?: number;
} = {}): Promise<{
  status: "completed" | "idle" | "partial";
  processed: number;
  results: Array<{ projectId: string; runId: string; status: "completed" | "failed" | "skipped"; message: string }>;
  message: string;
}> {
  const limit = clampWorkerLimit(input.limit);
  const candidates = await loadQueuedResearchPipelineRunsForWorker({
    projectId: input.projectId,
    limit
  });

  const results = [];
  for (const candidate of candidates) {
    try {
      const result = await withActiveIdentity(candidate.identity, () =>
        processQueuedPipelineRunForActiveScope({
          projectId: candidate.run.project_id,
          runId: candidate.run.id
        })
      );
      results.push({ projectId: candidate.run.project_id, ...result });
    } catch (error) {
      results.push({
        projectId: candidate.run.project_id,
        runId: candidate.run.id,
        status: "failed" as const,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const failed = results.filter((result) => result.status === "failed").length;
  const completed = results.filter((result) => result.status === "completed").length;
  return {
    status: results.length === 0 ? "idle" : failed > 0 ? "partial" : "completed",
    processed: results.length,
    results,
    message:
      results.length === 0
        ? "No queued research-brief pipeline runs were ready."
        : `Processed ${results.length} queued research run${results.length === 1 ? "" : "s"} (${completed} completed, ${failed} failed).`
  };
}

function clampWorkerLimit(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_WORKER_SWEEP_LIMIT;
  }
  return Math.max(1, Math.min(MAX_WORKER_SWEEP_LIMIT, Math.trunc(value)));
}

async function executeResearchBriefPipelineRun(input: {
  projectId: string;
  project: DbProject;
  preferences?: DbUserPreference;
  sources: DbSourceConfig[];
  githubConnections: Parameters<typeof runManagedBriefResearch>[0]["githubConnections"];
  existingOpportunities: Parameters<typeof rankOpportunitiesWithPreferences>[0]["existingOpportunities"];
  preferenceEvents: Parameters<typeof rankOpportunitiesWithPreferences>[0]["preferenceEvents"];
  run: DbPipelineRun;
  researchBrief: DbResearchBrief;
  tasks: DbAgentTask[];
}): Promise<void> {
  const reflection = await runReflection({ projectId: input.projectId });
  const reflectionLine = `Reflected on prior decisions and generated ${reflection.proposalCount} self-improvement proposal${reflection.proposalCount === 1 ? "" : "s"}`;
  let tasks = input.tasks.length
    ? input.tasks
    : await createBriefAgentTasks({
        projectId: input.projectId,
        runId: input.run.id,
        researchBrief: input.researchBrief
      });

  try {
    assertManagedBriefResearchReady();
    const managedDiscovery = await runManagedBriefResearch({
      project: input.project,
      preferences: input.preferences,
      researchBrief: input.researchBrief,
      sources: input.sources,
      githubConnections: input.githubConnections
    });
    const discovery = managedDiscovery ?? discoverNewProductIdeas({
      projectName: input.project.name ?? "New product",
      preferences: input.preferences,
      researchBrief: input.researchBrief
    });
    const taskUpdates = taskUpdatesForResearch(tasks, managedDiscovery?.metadata);
    await updateAgentTasks(input.projectId, taskUpdates);
    await replaceProjectDiscoveryRecords({
      projectId: input.projectId,
      runId: input.run.id,
      signals: discovery.signals,
      opportunities: rankOpportunitiesWithPreferences({
        opportunities: discovery.opportunities,
        existingOpportunities: input.existingOpportunities,
        preferenceEvents: input.preferenceEvents,
        preferences: input.preferences
      })
    });
    await updateResearchBriefStatus({
      projectId: input.projectId,
      briefId: input.researchBrief.id,
      status: "completed"
    });

    await completePipelineRun(input.projectId, input.run.id, {
      source: "research_brief",
      research_brief_id: input.researchBrief.id,
      worker: "pipeline_worker",
      managed_research: managedDiscovery?.metadata ?? { status: "not_configured" },
      digest_summary: researchBriefDigestSummary(discovery.opportunities.length, managedDiscovery?.metadata),
      changes: [
        reflectionLine,
        `Compiled approved brief: ${input.researchBrief.hypothesis}`,
        `Queued ${tasks.length} agent task${tasks.length === 1 ? "" : "s"} from the brief`,
        managedDiscovery
          ? `Managed research collected ${discovery.signals.length} source signal${discovery.signals.length === 1 ? "" : "s"}`
          : "Managed research backend is not configured; retained brief-origin hypothesis records",
        researchBriefOpportunityChange(discovery.opportunities.length, managedDiscovery?.metadata, Boolean(managedDiscovery))
      ],
      reflection_proposal_count: reflection.proposalCount,
      reflection_run_ids: reflection.runIds,
      research_brief: input.researchBrief,
      agent_tasks: tasks.map((task) => ({
        id: task.id,
        role: task.agent_role,
        status: taskUpdates.find((update) => update.id === task.id)?.status ?? "queued",
        result: taskUpdates.find((update) => update.id === task.id)?.result ?? null
      }))
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await updateAgentTasks(
      input.projectId,
      failedTaskUpdates(tasks, errorMessage)
    );
    await updateResearchBriefStatus({
      projectId: input.projectId,
      briefId: input.researchBrief.id,
      status: "approved"
    });
    await failPipelineRun(input.projectId, input.run.id, {
      source: "research_brief",
      research_brief_id: input.researchBrief.id,
      digest_summary: researchBriefFailureSummary(errorMessage),
      error: errorMessage,
      ...managedResearchMissingMetadata(errorMessage),
      reflection_proposal_count: reflection.proposalCount,
      reflection_run_ids: reflection.runIds
    });
    throw error;
  }
}

async function createBriefAgentTasks(input: {
  projectId: string;
  runId: string;
  researchBrief: DbResearchBrief;
}): Promise<DbAgentTask[]> {
  return createAgentTasks(
    BRIEF_AGENT_ROLES.map((role) => ({
      project_id: input.projectId,
      pipeline_run_id: input.runId,
      research_brief_id: input.researchBrief.id,
      agent_role: role,
      prompt: agentPromptForBrief(role, input.researchBrief)
    }))
  );
}

function failedTaskUpdates(tasks: Array<{ id: string }>, error: string) {
  return tasks.map((task) => ({
    id: task.id,
    status: "failed" as const,
    error
  }));
}

function researchBriefDigestSummary(promotedOpportunityCount: number, managedMetadata?: JsonObject): string {
  const managedCandidateCount = metadataNumber(managedMetadata, "opportunity_count") ?? 0;
  if (promotedOpportunityCount > 0) {
    return `Turned the approved idea brief into ${promotedOpportunityCount} build-ready research direction${
      promotedOpportunityCount === 1 ? "" : "s"
    } and queued agent tasks for source-backed follow-up.`;
  }
  if (managedMetadata && managedCandidateCount > 0) {
    return `Managed research found ${managedCandidateCount} candidate${
      managedCandidateCount === 1 ? "" : "s"
    }, but none cleared the evidence gate for recommendation cards yet.`;
  }
  return managedMetadata
    ? "Managed research completed without recommendation-ready candidates."
    : "Queued the approved idea brief for agent research. Recommendations require the managed research backend.";
}

function researchBriefOpportunityChange(
  promotedOpportunityCount: number,
  managedMetadata: JsonObject | undefined,
  managedConfigured: boolean
): string {
  const managedCandidateCount = metadataNumber(managedMetadata, "opportunity_count") ?? 0;
  if (promotedOpportunityCount > 0) {
    return managedConfigured
      ? `Promoted ${promotedOpportunityCount} evidence-ready candidate${promotedOpportunityCount === 1 ? "" : "s"}`
      : "Created brief-origin recommendations marked as hypotheses until source agents attach evidence";
  }
  if (managedConfigured && managedCandidateCount > 0) {
    return `Held ${managedCandidateCount} managed research candidate${
      managedCandidateCount === 1 ? "" : "s"
    } as research output because evidence did not clear the build gate`;
  }
  return "No recommendation cards were created without research-backed evidence";
}

function metadataNumber(metadata: JsonObject | undefined, key: string): number | null {
  const value = metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function researchBriefFailureSummary(error: string): string {
  return error === MANAGED_RESEARCH_BACKEND_REQUIRED_MESSAGE
    ? "Brief research is waiting for managed research backend configuration."
    : "Brief research failed before recommendations were created.";
}

function managedResearchMissingMetadata(error: string) {
  if (error !== MANAGED_RESEARCH_BACKEND_REQUIRED_MESSAGE) {
    return {};
  }
  return {
    managed_research: {
      status: "not_configured",
      missing: ["FORGE_MANAGED_RESEARCH_URL", "FORGE_MANAGED_RESEARCH_SECRET"]
    },
    missing: ["managed_research_backend"],
    changes: ["Skipped local brief-origin fallback because hosted mode requires source-backed managed research."]
  };
}

function githubSource(
  sources: Array<{ source_type: string; connection_id?: string | null; config?: Record<string, unknown> }>
): { repoUrl: string; connectionId?: string | null } | null {
  const source = sources.find((entry) => entry.source_type === "github" && entry.config?.repo_url);
  const repoUrl = typeof source?.config?.repo_url === "string" ? source.config.repo_url : "";
  return repoUrl ? { repoUrl, connectionId: source?.connection_id } : null;
}

function agentPromptForBrief(
  role: string,
  brief: {
    hypothesis: string;
    target_users: string[];
    pain_area: string;
    constraints?: string[];
    source_plan: string[];
    disqualifying_evidence: string[];
    mvp_boundaries: string[];
    user_taste_notes?: string[];
    open_questions?: string[];
  }
): string {
  return [
    `${role} task for Forge idea research.`,
    `Hypothesis: ${brief.hypothesis}`,
    brief.target_users.length ? `Target users: ${brief.target_users.join(", ")}` : "",
    brief.pain_area ? `Pain area: ${brief.pain_area}` : "",
    brief.constraints?.length ? `User and Forge constraints: ${brief.constraints.join("; ")}` : "",
    brief.user_taste_notes?.length ? `User taste notes from the conversation: ${brief.user_taste_notes.join("; ")}` : "",
    brief.source_plan.length ? `Source plan: ${brief.source_plan.join("; ")}` : "",
    brief.disqualifying_evidence.length
      ? `Stop or downrank if evidence shows: ${brief.disqualifying_evidence.join("; ")}`
      : "",
    brief.mvp_boundaries.length ? `MVP boundaries: ${brief.mvp_boundaries.join("; ")}` : "",
    brief.open_questions?.length ? `Known uncertainty: ${brief.open_questions.join("; ")}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}
