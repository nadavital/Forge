import { loadStore, getProjectBundle } from "@/lib/db/repository";
import type {
  ContractBuild,
  ContractBuildArtifact,
  ContractEvidence,
  ContractOpportunity,
  ContractPrototypeOption,
  DecisionRecommendation,
  MorningDigest,
  MorningReviewProject,
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
  return Promise.all(
    store.projects.filter((project) => !project.archived_at).map((project) => mapProject(project, store))
  );
}

export async function loadForgeProject(projectId: string): Promise<MorningReviewProject | null> {
  const store = await loadStore();
  const project = store.projects.find((row) => row.id === projectId && !row.archived_at);
  if (!project) {
    return null;
  }
  return mapProject(project, store);
}

async function mapProject(project: DbProject, store: ForgeStore): Promise<MorningReviewProject> {
  const bundle = await getProjectBundle(project.id, store);
  const latestRun = [...bundle.runs].sort((a, b) => runTime(b) - runTime(a))[0];
  const runOpportunities = bundle.opportunities
    .filter((opportunity) => !latestRun || opportunity.pipeline_run_id === latestRun.id || !opportunity.pipeline_run_id)
    .map((opportunity) =>
      mapOpportunity(
        opportunity,
        bundle.links.filter((link) => link.opportunity_id === opportunity.id),
        bundle.signals,
        bundle.evaluations.filter((evaluation) => evaluation.opportunity_id === opportunity.id),
        bundle.prototypes.filter((prototype) => prototype.opportunity_id === opportunity.id),
        bundle.builds.find((build) => build.opportunity_id === opportunity.id),
        bundle.artifacts
      )
    )
    .sort((a, b) => b.score - a.score);

  const signalCount = new Set(
    bundle.links
      .filter((link) => bundle.opportunities.some((opportunity) => opportunity.id === link.opportunity_id))
      .map((link) => link.signal_id)
  ).size;

  return {
    id: project.id,
    name: project.name,
    mode: projectModeLabel(project.mode),
    runStatus: runStatus(latestRun),
    signalCount: signalCount || bundle.signals.length,
    opportunities: runOpportunities,
    digest: mapDigest(latestRun, runOpportunities)
  };
}

function mapOpportunity(
  opportunity: DbOpportunity,
  links: DbOpportunitySignal[],
  signals: DbSignal[],
  evaluations: DbEvaluation[],
  prototypeRows: DbPrototype[],
  buildRow: DbMvpBuild | undefined,
  artifacts: DbBuildArtifact[]
): ContractOpportunity {
  const signalsById = new Map(signals.map((signal) => [signal.id, signal]));
  const taste = findEvaluation(evaluations, "taste_critic");
  const bull = findEvaluation(evaluations, "bull");
  const bear = findEvaluation(evaluations, "bear");
  const decisionEval = findEvaluation(evaluations, "decision_agent");

  return {
    id: opportunity.id,
    title: cleanText(opportunity.title) || "Untitled opportunity",
    score: normalizeScore(opportunity.score),
    status: cleanText(opportunity.status) || "proposed",
    problem: cleanText(opportunity.problem) || cleanText(opportunity.score_rationale) || "No problem statement.",
    targetUser: cleanText(opportunity.target_user) || "Unknown",
    mvpConcept: cleanText(opportunity.mvp_concept) || "Not specified",
    tasteCritique:
      firstLine(taste?.content) ||
      stringFromScores(taste?.scores, "summary") ||
      "No taste critique recorded.",
    decision: mapDecision(decisionEval, opportunity),
    debate: {
      bull: firstLine(bull?.content) || "No bull case recorded.",
      bear: firstLine(bear?.content) || "No bear case recorded."
    },
    evidence: mapEvidence(links, signalsById),
    prototypes: mapPrototypes(prototypeRows),
    build: buildRow ? mapBuild(buildRow, artifacts.filter((artifact) => artifact.mvp_build_id === buildRow.id)) : undefined
  };
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
    topRecommendation: opportunities[0]?.decision.summary,
    reflectionProposalCount:
      typeof metadata.reflection_proposal_count === "number" ? metadata.reflection_proposal_count : undefined
  };
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
  const runs = projectId
    ? store.reflection_runs.filter((run) => run.project_id === projectId)
    : store.reflection_runs;

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
