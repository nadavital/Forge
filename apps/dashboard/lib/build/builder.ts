import { createBuildBrief, type BuildBrief } from "@/lib/build/brief";
import { buildReadinessForOpportunity } from "@/lib/build/readiness";
import { projectBuildReadiness } from "@/lib/build/project-readiness";
import { runManagedGeminiBuilder } from "@/lib/build/managed-gemini-builder";
import type { BuilderAdapter } from "@/lib/build/adapter";
import {
  createMvpBuild,
  getProjectBundle,
  insertBuildArtifacts,
  recordPreferenceEvent,
  updateOpportunityStatus
} from "@/lib/db/repository";
import type { DbMvpBuild } from "@/lib/db/types";
import { runSimulatedBuilder } from "@/lib/simulated-builder";

export type { BuilderAdapter };

export async function queueOpportunityBuild(input: {
  projectId: string;
  opportunityId: string;
  adapter?: BuilderAdapter;
}): Promise<{ build: DbMvpBuild; adapter: BuilderAdapter }> {
  const bundle = await getProjectBundle(input.projectId);
  const project = bundle.project;
  if (!project) {
    throw new Error("Project not found.");
  }

  const opportunity = bundle.opportunities.find((row) => row.id === input.opportunityId);
  if (!opportunity) {
    throw new Error("Opportunity not found.");
  }

  const evidenceIds = new Set(
    bundle.links.filter((link) => link.opportunity_id === opportunity.id).map((link) => link.signal_id)
  );
  const evidenceSignals = bundle.signals.filter((signal) => evidenceIds.has(signal.id));
  const evaluations = bundle.evaluations.filter((evaluation) => evaluation.opportunity_id === opportunity.id);
  const readiness = buildReadinessForOpportunity({
    opportunity,
    evaluations,
    evidenceCount: evidenceIds.size,
    evidence: evidenceSignals
  });
  if (!readiness.canBuild) {
    throw new Error(readiness.reason);
  }
  const buildPathReadiness = projectBuildReadiness({
    project,
    sources: bundle.sources,
    githubConnections: bundle.githubConnections,
    requestedAdapter: input.adapter
  });
  if (!buildPathReadiness.canBuild) {
    throw new Error(buildPathReadiness.reason);
  }
  const adapter = buildPathReadiness.adapter;
  const githubTarget = buildPathReadiness.githubTarget;
  const brief = createBuildBrief({
    adapter: adapter === "managed" ? "gemini_managed" : "simulated",
    opportunity,
    project,
    githubConnectionId: githubTarget.githubConnectionId,
    githubConnectionAccountLogin: githubTarget.generatedRepoAccountLogin,
    githubConnectionCanCreateRepos: githubTarget.generatedRepoCanCreate,
    userPreferenceNotes: bundle.preferences?.notes,
    evidence: evidenceSignals,
    evaluations
  });

  await updateOpportunityStatus({
    projectId: input.projectId,
    opportunityId: input.opportunityId,
    status: "building"
  });

  const build = await createMvpBuild({
    projectId: input.projectId,
    opportunityId: input.opportunityId,
    buildBrief: brief
  });

  await recordPreferenceEvent({
    projectId: input.projectId,
    opportunityId: input.opportunityId,
    eventType: "approved",
    mvpBuildId: build.id,
    payload: {
      action: "build_requested",
      adapter,
      managed: adapter === "managed"
    }
  });

  if (adapter === "managed") {
    void runManagedGeminiBuilder({
      projectId: input.projectId,
      opportunityId: input.opportunityId,
      build,
      brief,
      githubConnection: githubTarget.githubConnection
    });
    return { build, adapter };
  }

  await runSimulatedBuilder({
    projectId: input.projectId,
    opportunityId: input.opportunityId,
    build
  });
  await insertBuildArtifacts({
    projectId: input.projectId,
    buildId: build.id,
    artifacts: [
      {
        artifact_type: "build_brief",
        content: JSON.stringify(redactBriefForArtifact(brief), null, 2)
      }
    ]
  });

  return { build, adapter };
}

function redactBriefForArtifact(brief: BuildBrief): BuildBrief {
  return {
    ...brief,
    project: {
      ...brief.project,
      repo_url: brief.project.repo_url
    }
  };
}
