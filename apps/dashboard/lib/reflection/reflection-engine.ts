import {
  createReflectionRun,
  getProjectBundle,
  loadStore
} from "@/lib/db/repository";
import type {
  DbMvpBuild,
  DbPreferenceEvent,
  DbProject,
  DbReflectionProposal,
  ForgeStore,
  JsonObject
} from "@/lib/db/types";

type ProposalDraft = Omit<DbReflectionProposal, "id" | "reflection_run_id" | "status"> & {
  patch?: JsonObject;
};

export async function runReflection(input: { projectId?: string } = {}): Promise<{
  runIds: string[];
  proposalCount: number;
}> {
  const store = await loadStore();
  const projects = input.projectId
    ? store.projects.filter((project) => project.id === input.projectId)
    : store.projects;
  const runIds: string[] = [];
  let proposalCount = 0;

  for (const project of projects) {
    const result = await reflectProject(project, store);
    runIds.push(result.runId);
    proposalCount += result.proposalCount;
  }

  return { runIds, proposalCount };
}

async function reflectProject(project: DbProject, store: ForgeStore): Promise<{ runId: string; proposalCount: number }> {
  const bundle = await getProjectBundle(project.id, store);
  const evidence = buildEvidence({
    events: bundle.preferenceEvents,
    builds: bundle.builds,
    project
  });
  const proposals = buildProposals({
    project,
    events: bundle.preferenceEvents,
    builds: bundle.builds,
    evidence
  });

  const run = await createReflectionRun({
    projectId: project.id,
    summary: reflectionSummary(project, evidence, proposals),
    evidence,
    proposals
  });

  return { runId: run.id, proposalCount: proposals.length };
}

function buildEvidence(input: {
  project: DbProject;
  events: DbPreferenceEvent[];
  builds: DbMvpBuild[];
}): JsonObject {
  const eventCounts = countBy(input.events, (event) => event.event_type);
  const buildCounts = countBy(input.builds, (build) => build.status || "unknown");
  const recentEvents = input.events.slice(0, 8).map((event) => ({
    event_type: event.event_type,
    opportunity_id: event.opportunity_id,
    created_at: event.created_at,
    payload: event.payload
  }));

  return {
    project_id: input.project.id,
    project_name: input.project.name,
    event_counts: eventCounts,
    build_counts: buildCounts,
    recent_events: recentEvents,
    analyzed_at: new Date().toISOString()
  };
}

function buildProposals(input: {
  project: DbProject;
  events: DbPreferenceEvent[];
  builds: DbMvpBuild[];
  evidence: JsonObject;
}): ProposalDraft[] {
  const counts = input.evidence.event_counts as Record<string, number>;
  const buildCounts = input.evidence.build_counts as Record<string, number>;
  const proposals: ProposalDraft[] = [];

  if ((counts.ignored ?? 0) + (counts.feedback ?? 0) > 0) {
    proposals.push({
      proposal_type: "rubric",
      risk_level: "review_required",
      title: "Prefer shorter decision cards after pushback",
      rationale:
        "This project has ignored or refinement feedback events, so future morning reviews should lead with a decision and keep evidence secondary.",
      patch: {
        target: "morning_review_rubric",
        change: "Cap top-level evidence chips and require one recommended next action."
      }
    });
  }

  if ((counts.rejected ?? 0) > 0) {
    proposals.push({
      proposal_type: "scoring",
      risk_level: "low",
      title: "Downweight rejected opportunity patterns",
      rationale:
        "The user rejected at least one recommendation. Similar future opportunities should lose score unless new evidence is stronger.",
      patch: {
        target: "preference_model",
        change: "Apply negative similarity weight from rejected opportunities."
      }
    });
  }

  if ((counts.approved ?? 0) > 0 || (buildCounts.completed ?? 0) > 0) {
    proposals.push({
      proposal_type: "preference",
      risk_level: "low",
      title: "Boost ideas that resemble approved builds",
      rationale:
        "Approved/build-completed opportunities are positive taste evidence, so the ranking model should give similar narrow MVPs a modest boost.",
      patch: {
        target: "preference_model",
        change: "Apply positive similarity weight from approved and completed build events."
      }
    });
  }

  if ((buildCounts.failed ?? 0) > 0 || (buildCounts.blocked ?? 0) > 0) {
    proposals.push({
      proposal_type: "eval_case",
      risk_level: "review_required",
      title: "Add a builder failure regression case",
      rationale:
        "A build failed or blocked, so Forge should add an eval case that checks future build briefs avoid the same failure mode.",
      patch: {
        target: "builder_eval_cases",
        change: "Create a local eval from failed build logs and expected BuildReviewer checks."
      }
    });
  }

  if (proposals.length === 0) {
    proposals.push({
      proposal_type: "eval_case",
      risk_level: "low",
      title: "Add a no-feedback baseline eval",
      rationale:
        "This project has no strong feedback signal yet. Forge should preserve a baseline eval so the first demo loop remains stable.",
      patch: {
        target: "reflection_eval_cases",
        change: "Assert that no-feedback projects produce one safe, reviewable proposal and do not mutate policy."
      }
    });
  }

  return proposals;
}

function reflectionSummary(project: DbProject, evidence: JsonObject, proposals: ProposalDraft[]): string {
  const eventCounts = evidence.event_counts as Record<string, number>;
  const totalEvents = Object.values(eventCounts).reduce((sum, value) => sum + value, 0);
  return `${project.name}: reviewed ${totalEvents} preference events and generated ${proposals.length} Forge self-improvement proposal${proposals.length === 1 ? "" : "s"}.`;
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  return items.reduce<Record<string, number>>((counts, item) => {
    const value = key(item);
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}
