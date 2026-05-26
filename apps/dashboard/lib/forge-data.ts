import { getActiveIdentity, getProjectBundle, loadStore } from "@/lib/db/repository";
import { projectVisibleToIdentity, visibleProjectIdsForIdentity } from "@/lib/db/identity-scope";
import { buildReadinessForOpportunity } from "@/lib/build/readiness";
import { projectBuildReadiness, type ProjectBuildReadiness } from "@/lib/build/project-readiness";
import {
  evidenceStateLabel,
  evidenceStateSummary,
  mapOpportunityEvidenceState
} from "@/lib/opportunity-evidence-state";
import { synthesisFromEvaluations } from "@/lib/evaluation-synthesis";
import { mapOpportunityReviewContext } from "@/lib/opportunity-review-context";
import type {
  ContractBuild,
  ContractBuildArtifact,
  ContractEvidence,
  ContractOpportunity,
  ContractPrototypeOption,
  DecisionRecommendation,
  MorningDigest,
  MorningReviewProject,
  ProjectMode,
  ReflectionProposal
} from "@/types/forge";
import type {
  DbBuildArtifact,
  DbEvaluation,
  DbMvpBuild,
  DbOpportunity,
  DbOpportunitySignal,
  DbPipelineRun,
  DbProject,
  DbPrototype,
  DbSignal,
  ForgeStore,
  JsonObject
} from "@/lib/db/types";

export async function loadForgeProjects(): Promise<MorningReviewProject[]> {
  const store = await loadStore();
  const identity = await getActiveIdentity();
  return Promise.all(
    store.projects
      .filter((project) => !project.archived_at && projectVisibleToIdentity(project, identity))
      .map((project) => mapProject(project, store))
  );
}

export async function loadForgeProject(projectId: string): Promise<MorningReviewProject | null> {
  const store = await loadStore();
  const identity = await getActiveIdentity();
  const project = store.projects.find((row) => row.id === projectId && !row.archived_at);
  if (!project || !projectVisibleToIdentity(project, identity)) {
    return null;
  }
  return mapProject(project, store);
}

async function mapProject(project: DbProject, store: ForgeStore): Promise<MorningReviewProject> {
  const bundle = await getProjectBundle(project.id, store);
  const latestRun = [...bundle.runs].sort((a, b) => runTime(b) - runTime(a))[0];
  const buildPathReadiness = projectBuildReadiness({
    project,
    sources: bundle.sources,
    githubConnections: bundle.githubConnections
  });
  const runOpportunities = bundle.opportunities
    .map((opportunity) =>
      mapOpportunity(
        opportunity,
        bundle.links.filter((link) => link.opportunity_id === opportunity.id),
        bundle.signals,
        bundle.evaluations.filter((evaluation) => evaluation.opportunity_id === opportunity.id),
        bundle.prototypes.filter((prototype) => prototype.opportunity_id === opportunity.id),
        latestBuildForOpportunity(bundle.builds, opportunity.id),
        bundle.artifacts,
        buildPathReadiness
      )
    )
    .sort((a, b) => opportunitySortScore(b, latestRun?.id) - opportunitySortScore(a, latestRun?.id));

  const signalCount = new Set(
    bundle.links
      .filter((link) => bundle.opportunities.some((opportunity) => opportunity.id === link.opportunity_id))
      .map((link) => link.signal_id)
  ).size;

  return {
    id: project.id,
    name: project.name,
    mode: projectModeLabel(project.mode),
    modeKey: projectModeKey(project.mode),
    needsGitHubConnection: needsGitHubConnection(project, bundle.sources),
    runStatus: runStatus(latestRun),
    signalCount: signalCount || bundle.signals.length,
    opportunities: runOpportunities,
    digest: mapDigest(latestRun, runOpportunities)
  };
}

function needsGitHubConnection(
  project: DbProject,
  sources: Array<{ source_type: string; connection_id?: string | null; config?: JsonObject }>
): boolean {
  if (project.mode !== "connected_product") {
    return false;
  }
  const githubSource = sources.find((source) => source.source_type === "github");
  const repoUrl = project.repo_url || stringConfig(githubSource?.config, "repo_url") || "";
  return Boolean(repoUrl && !githubSource?.connection_id);
}

function stringConfig(config: JsonObject | undefined, key: string): string {
  const value = config?.[key];
  return typeof value === "string" ? value : "";
}

function mapOpportunity(
  opportunity: DbOpportunity,
  links: DbOpportunitySignal[],
  signals: DbSignal[],
  evaluations: DbEvaluation[],
  prototypeRows: DbPrototype[],
  buildRow: DbMvpBuild | undefined,
  artifacts: DbBuildArtifact[],
  buildPathReadiness: ProjectBuildReadiness
): ContractOpportunity {
  const signalsById = new Map(signals.map((signal) => [signal.id, signal]));
  const taste = findEvaluation(evaluations, "taste_critic");
  const bull = findEvaluation(evaluations, "bull");
  const bear = findEvaluation(evaluations, "bear");
  const decisionEval = findEvaluation(evaluations, "decision_agent");
  const synthesis = synthesisFromEvaluations(evaluations);
  const evidence = mapEvidence(links, signalsById);
  const evidenceState = mapOpportunityEvidenceState(opportunity.profile, evidence.length);
  const opportunityBuildReadiness = buildReadinessForOpportunity({
    opportunity,
    evaluations,
    evidenceCount: evidence.length,
    evidence
  });
  const buildReadiness = combineBuildReadiness(opportunityBuildReadiness, buildPathReadiness);

  return {
    id: opportunity.id,
    title: cleanText(opportunity.title) || "Untitled opportunity",
    score: normalizeScore(opportunity.score),
    status: cleanText(opportunity.status) || "proposed",
    evidenceState,
    evidenceLabel: evidenceStateLabel(evidenceState),
    evidenceSummary: evidenceStateSummary(evidenceState, evidence.length),
    buildReadiness,
    reviewContext: mapOpportunityReviewContext(opportunity.profile),
    problem: cleanText(opportunity.problem) || cleanText(opportunity.score_rationale) || "No problem statement.",
    targetUser: cleanText(opportunity.target_user) || "Unknown",
    mvpConcept: cleanText(opportunity.mvp_concept) || "Not specified",
    synthesis,
    tasteCritique:
      firstLine(taste?.content) ||
      stringFromScores(taste?.scores, "summary") ||
      "No taste critique recorded.",
    decision: mapDecision(decisionEval, opportunity),
    debate: {
      bull: firstLine(bull?.content) || "No bull case recorded.",
      bear: firstLine(bear?.content) || "No bear case recorded."
    },
    evidence,
    prototypes: mapPrototypes(prototypeRows),
    build: buildRow ? mapBuild(buildRow, artifacts.filter((artifact) => artifact.mvp_build_id === buildRow.id)) : undefined
  };
}

function combineBuildReadiness(
  opportunityReadiness: ContractOpportunity["buildReadiness"],
  projectReadiness: ContractOpportunity["buildReadiness"]
): ContractOpportunity["buildReadiness"] {
  if (!opportunityReadiness.canBuild) return opportunityReadiness;
  if (!projectReadiness.canBuild) return projectReadiness;
  return opportunityReadiness;
}

function mapDecision(
  decisionEval: DbEvaluation | undefined,
  opportunity: DbOpportunity
): ContractOpportunity["decision"] {
  const recommendation =
    parseRecommendation(stringFromScores(decisionEval?.scores, "recommendation")) ||
    inferRecommendation(opportunity.status);

  return {
    recommendation,
    summary:
      firstLine(decisionEval?.content) ||
      cleanText(opportunity.score_rationale) ||
      "Review this opportunity.",
    confidence: numberFromScores(decisionEval?.scores, "confidence") ?? 0.5
  };
}

function mapEvidence(links: DbOpportunitySignal[], signalsById: Map<string, DbSignal>): ContractEvidence[] {
  return links
    .map((link) => (link.signal_id ? signalsById.get(link.signal_id) : undefined))
    .filter((signal): signal is DbSignal => Boolean(signal))
    .map((signal) => ({
      source: cleanText(signal.source) || "signal",
      label: cleanText(signal.title) || truncate(cleanText(signal.body), 80) || "Linked signal",
      url: signal.url
    }));
}

function mapPrototypes(rows: DbPrototype[]): ContractPrototypeOption[] {
  return rows.map((row) => ({
    id: row.id,
    title: cleanText(row.title) || "Prototype",
    status: parsePrototypeStatus(row.status),
    artifactUrl: row.artifact_url
  }));
}

function mapBuild(row: DbMvpBuild, artifacts: DbBuildArtifact[]): ContractBuild {
  return {
    id: row.id,
    status: parseBuildStatus(row.status),
    prUrl: row.pr_url,
    generatedRepoUrl: row.generated_repo_url,
    logs: row.logs,
    artifacts: artifacts.map(mapArtifact)
  };
}

function latestBuildForOpportunity(builds: DbMvpBuild[], opportunityId: string): DbMvpBuild | undefined {
  return builds
    .filter((build) => build.opportunity_id === opportunityId)
    .sort((a, b) => buildTime(b) - buildTime(a))[0];
}

function buildTime(build: DbMvpBuild): number {
  const stamp = build.updated_at || build.created_at;
  return stamp ? new Date(stamp).getTime() : 0;
}

function mapArtifact(row: DbBuildArtifact): ContractBuildArtifact {
  return {
    type: row.artifact_type,
    content: cleanText(row.content),
    url: row.url
  };
}

function mapDigest(run: DbPipelineRun | undefined, opportunities: ContractOpportunity[]): MorningDigest | undefined {
  if (!run?.metadata) {
    return undefined;
  }

  const metadata = run.metadata;
  const changes = Array.isArray(metadata.changes)
    ? metadata.changes.filter((item): item is string => typeof item === "string")
    : [];

  return {
    summary: typeof metadata.digest_summary === "string" ? metadata.digest_summary : "Morning review ready.",
    changes,
    projectKnowledge: mapProjectKnowledge(metadata.project_knowledge),
    stages: mapRunStages(run, metadata),
    topRecommendation: opportunities[0]?.decision.summary,
    reflectionProposalCount:
      typeof metadata.reflection_proposal_count === "number" ? metadata.reflection_proposal_count : undefined
  };
}

function mapProjectKnowledge(value: unknown): MorningDigest["projectKnowledge"] {
  const knowledge = objectValue(value);
  if (!knowledge) {
    return undefined;
  }

  const surfaces = Array.isArray(knowledge.app_surfaces)
    ? knowledge.app_surfaces
        .map((surface) => objectValue(surface))
        .filter((surface): surface is JsonObject => Boolean(surface))
        .map((surface) => ({
          label: cleanText(surface.label) || cleanText(surface.id) || "Detected surface",
          evidenceFiles: Array.isArray(surface.evidence_files)
            ? surface.evidence_files.filter((file): file is string => typeof file === "string").slice(0, 4)
            : []
        }))
        .slice(0, 4)
    : [];

  const counts = objectValue(knowledge.evidence_counts);

  return {
    summary: cleanText(knowledge.semantic_summary) || "Forge formed a baseline project memory from repo context.",
    frameworks: Array.isArray(knowledge.frameworks)
      ? knowledge.frameworks.filter((item): item is string => typeof item === "string")
      : [],
    workflows: Array.isArray(knowledge.product_workflows)
      ? knowledge.product_workflows.filter((item): item is string => typeof item === "string").slice(0, 6)
      : [],
    surfaces,
    evidenceCounts: {
      filesSeen: typeof counts?.files_seen === "number" ? counts.files_seen : undefined,
      issuesSeen: typeof counts?.issues_seen === "number" ? counts.issues_seen : undefined,
      actionableIssues: typeof counts?.actionable_issues === "number" ? counts.actionable_issues : undefined,
      surfacesDetected: typeof counts?.surfaces_detected === "number" ? counts.surfaces_detected : undefined
    }
  };
}

function mapRunStages(run: DbPipelineRun, metadata: JsonObject): MorningDigest["stages"] {
  const running = run.status === "running";
  const failed = run.status === "failed";
  const source = cleanText(metadata.source);
  const repoFastRun = source === "github";
  const sourceCollection = objectValue(metadata.source_collection);
  const repoAnalysis = objectValue(metadata.repo_analysis);
  const repoScan = objectValue(repoAnalysis?.repo_scan);
  const research = objectValue(metadata.deep_research) || (metadata.pipeline === "trend_research" ? metadata : null);
  const clustering = objectValue(metadata.opportunity_clustering);
  const bullBear = objectValue(metadata.bull_bear) || (metadata.pipeline === "bull_bear_evaluation" ? metadata : null);
  const opportunityCount = numberFromMetadata(metadata, "opportunity_count") ?? countFromDigest(metadata);
  const changes = Array.isArray(metadata.changes)
    ? metadata.changes.filter((item): item is string => typeof item === "string")
    : [];

  return [
    {
      label: repoFastRun ? "Repo analysis" : "Signal collection",
      status: stageStatus({
        present:
          Boolean(sourceCollection) ||
          repoFastRun ||
          metadata.pipeline === "source_collect" ||
          changes.some((change) => /collected|generated/i.test(change)),
        running,
        failed
      }),
      detail: sourceCollection
        ? countDetail(sourceCollection, "signals_saved", "signals collected")
        : repoFastRun
          ? repoScanDetail(repoScan)
        : metadata.pipeline === "source_collect"
          ? countDetail(metadata, "signal_count", "signals collected")
          : "Collects public signals, repo context, and manual inputs."
    },
    {
      label: repoFastRun ? "Managed inspection" : "Research",
      status: repoFastRun ? managedInspectionStatus(repoAnalysis, running, failed) : researchStatus(research, running, failed),
      detail: repoFastRun ? managedInspectionDetail(repoAnalysis) : researchDetail(research)
    },
    {
      label: "Bull/Bear critique",
      status: repoFastRun ? "not_run" : stageStatus({ present: Boolean(bullBear), running, failed }),
      detail: repoFastRun
        ? "Not run for fast repo import. Bull/Bear runs after managed research or clustering when evidence is strong enough."
        : bullBear
        ? "Bull, Bear, Decision, and Synthesizer outputs are attached to the recommendation."
        : "Challenges evidence quality, demand, scope, and build readiness."
    },
    {
      label: "Recommendation synthesis",
      status: stageStatus({ present: Boolean(clustering) || Boolean(bullBear) || Boolean(repoAnalysis), running, failed }),
      detail: clustering
        ? countDetail(clustering, "clusters_saved_in_run_metadata", "candidate clusters ranked")
        : repoFastRun && opportunityCount > 0
          ? `${opportunityCount} Antigravity recommendation${opportunityCount === 1 ? "" : "s"} created from repository evidence.`
        : repoFastRun
          ? "Project memory collected; no recommendations were created without managed evidence."
        : "Turns clustered opportunities into the next action."
    }
  ];
}

function repoScanDetail(repoScan: JsonObject | null): string {
  if (!repoScan) return "Collected GitHub repo context before managed inspection.";
  const files = typeof repoScan.files_seen === "number" ? repoScan.files_seen : 0;
  const issues = typeof repoScan.issues_seen === "number" ? repoScan.issues_seen : 0;
  return `Collected ${files} repository files and ${issues} issue${issues === 1 ? "" : "s"} for managed inspection.`;
}

function managedInspectionStatus(
  repoAnalysis: JsonObject | null,
  running: boolean,
  failed: boolean
): "completed" | "running" | "waiting" | "failed" {
  if (failed) return "failed";
  if (repoAnalysis?.status === "completed") return "completed";
  return running ? "running" : "waiting";
}

function managedInspectionDetail(repoAnalysis: JsonObject | null): string {
  if (!repoAnalysis) return "Antigravity clones and inspects the repository before recommendations are shown.";
  const elapsed = typeof repoAnalysis.elapsed_ms === "number" ? ` in ${Math.round(repoAnalysis.elapsed_ms / 1000)}s` : "";
  const count = typeof repoAnalysis.opportunity_count === "number" ? repoAnalysis.opportunity_count : 0;
  return `Antigravity inspected the repository${elapsed} and returned ${count} recommendation${count === 1 ? "" : "s"}.`;
}

function objectValue(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : null;
}

function stageStatus(input: { present: boolean; running: boolean; failed: boolean }): "completed" | "running" | "waiting" | "failed" {
  if (input.failed) return "failed";
  if (input.present) return "completed";
  return input.running ? "running" : "waiting";
}

function numberFromMetadata(metadata: JsonObject, key: string): number | null {
  const value = metadata[key];
  return typeof value === "number" ? value : null;
}

function countFromDigest(metadata: JsonObject): number {
  const digest = cleanText(metadata.digest_summary);
  const match = digest.match(/generated (\d+)/i);
  return match ? Number(match[1]) : 0;
}

function researchStatus(
  research: JsonObject | null,
  running: boolean,
  failed: boolean
): "completed" | "running" | "waiting" | "failed" {
  if (failed) return "failed";
  if (!research) return running ? "running" : "waiting";
  if (research.status === "failed_non_blocking") return "failed";
  return "completed";
}

function researchDetail(research: JsonObject | null): string {
  if (!research) return "Managed research may take 1-3 minutes; Forge keeps prior collected signals visible while it runs.";
  if (research.status === "local_source_research") {
    return "Used fast local source research for this run; managed research can run when latency budget allows.";
  }
  if (research.status === "failed_non_blocking") {
    return `Managed research did not complete: ${cleanText(research.error) || "non-blocking failure"}`;
  }
  if (typeof research.research_findings_saved_in_run_metadata === "number") {
    return `${research.research_findings_saved_in_run_metadata} research findings saved from managed analysis.`;
  }
  if (typeof research.research_finding_count === "number") {
    return `${research.research_finding_count} research findings saved from managed analysis.`;
  }
  return "Managed research completed and evidence was normalized.";
}

function countDetail(value: JsonObject, key: string, label: string): string {
  const count = value[key];
  return typeof count === "number" ? `${count} ${label}.` : label;
}

function parseRecommendation(value: string): DecisionRecommendation | null {
  const normalized = value.toLowerCase().replace(/\s+/g, "_");
  if (
    normalized === "watch" ||
    normalized === "research_more" ||
    normalized === "prototype" ||
    normalized === "build" ||
    normalized === "reject"
  ) {
    return normalized;
  }
  return null;
}

function inferRecommendation(status: string | null | undefined): DecisionRecommendation {
  if (status === "watching") return "watch";
  if (status === "researching") return "research_more";
  if (status === "rejected") return "reject";
  if (status === "approved" || status === "building" || status === "built") return "build";
  return "prototype";
}

function parsePrototypeStatus(
  status: string | null | undefined
): ContractPrototypeOption["status"] {
  if (
    status === "proposed" ||
    status === "generated" ||
    status === "selected" ||
    status === "rejected" ||
    status === "failed"
  ) {
    return status;
  }
  return "proposed";
}

function parseBuildStatus(status: string | null | undefined): ContractBuild["status"] {
  if (
    status === "queued" ||
    status === "briefed" ||
    status === "building" ||
    status === "reviewing" ||
    status === "completed" ||
    status === "failed" ||
    status === "blocked"
  ) {
    return status;
  }
  return "queued";
}

function findEvaluation(evaluations: DbEvaluation[], evaluator: string): DbEvaluation | undefined {
  return evaluations.find((evaluation) => evaluation.evaluator === evaluator);
}

function projectModeLabel(mode: string): string {
  if (mode === "connected_product") return "Connected product";
  if (mode === "new_product") return "New product";
  return mode.replace(/_/g, " ");
}

function projectModeKey(mode: string): ProjectMode {
  return mode === "new_product" ? "new_product" : "connected_product";
}

function runStatus(run: DbPipelineRun | undefined): string {
  if (!run) return "Not run yet";
  if (run.status === "completed" && run.completed_at) {
    return `Completed ${formatTime(run.completed_at)}`;
  }
  if (run.status === "running") return "Running…";
  return `Run ${run.status || "unknown"}`;
}

function runTime(run: DbPipelineRun): number {
  const stamp = run.completed_at || run.started_at;
  return stamp ? new Date(stamp).getTime() : 0;
}

function opportunitySortScore(opportunity: ContractOpportunity, latestRunId?: string): number {
  const currentRunBoost = latestRunId && opportunity.status !== "built" ? 0 : 0;
  const builtBoost = opportunity.build?.status === "completed" ? 8 : 0;
  return opportunity.score + currentRunBoost + builtBoost;
}

function normalizeScore(score: DbOpportunity["score"]): number {
  const value = Number(score ?? 0);
  if (!Number.isFinite(value)) return 0;
  return Math.round(value <= 1 ? value * 100 : value);
}

function numberFromScores(scores: JsonObject | null | undefined, key: string): number | null {
  const value = scores?.[key];
  return typeof value === "number" ? value : null;
}

function stringFromScores(scores: JsonObject | null | undefined, key: string): string {
  const value = scores?.[key];
  return typeof value === "string" ? value : "";
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function firstLine(value: unknown): string {
  const text = cleanText(value);
  return text.split(/\n+/)[0]?.trim() ?? "";
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export async function loadReflectionProposals(projectId?: string): Promise<ReflectionProposal[]> {
  const store = await loadStore();
  const identity = await getActiveIdentity();
  const visibleProjectIds = visibleProjectIdsForIdentity(store.projects, identity);
  const runs = projectId
    ? store.reflection_runs.filter((run) => run.project_id === projectId && visibleProjectIds.has(run.project_id))
    : store.reflection_runs.filter((run) => run.project_id && visibleProjectIds.has(run.project_id));

  return store.reflection_proposals
    .filter((proposal) => runs.some((run) => run.id === proposal.reflection_run_id))
    .map((proposal) => {
      const run = store.reflection_runs.find((entry) => entry.id === proposal.reflection_run_id);
      return {
        id: proposal.id,
        projectId: run?.project_id || "acme",
        title: proposal.title,
        rationale: proposal.rationale || "",
        proposalType: proposal.proposal_type,
        riskLevel: proposal.risk_level as ReflectionProposal["riskLevel"],
        status: proposal.status as ReflectionProposal["status"]
      };
    });
}
