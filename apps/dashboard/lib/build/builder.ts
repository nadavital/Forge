import { createBuildBrief, type BuildBrief } from "@/lib/build/brief";
import { canUseManagedGeminiBuilder, runManagedGeminiBuilder } from "@/lib/build/managed-gemini-builder";
import {
  createMvpBuild,
  getProjectBundle,
  insertBuildArtifacts,
  recordPreferenceEvent,
  updateOpportunityStatus
} from "@/lib/db/repository";
import type { DbMvpBuild } from "@/lib/db/types";
import { runSimulatedBuilder } from "@/lib/simulated-builder";

export type BuilderAdapter = "managed" | "simulated";

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
  const adapter = selectBuilderAdapter({
    requested: input.adapter,
    hasBuildTarget: true
  });
  const brief = createBuildBrief({
    adapter: adapter === "managed" ? "gemini_managed" : "simulated",
    opportunity,
    project,
    evidence: bundle.signals.filter((signal) => evidenceIds.has(signal.id)),
    evaluations: bundle.evaluations.filter((evaluation) => evaluation.opportunity_id === opportunity.id)
  });

  await updateOpportunityStatus(input.opportunityId, "building");

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
      brief
    });
    return { build, adapter };
  }

  await runSimulatedBuilder({
    projectId: input.projectId,
    opportunityId: input.opportunityId,
    build
  });
  await insertBuildArtifacts(build.id, [
    {
      artifact_type: "build_brief",
      content: JSON.stringify(redactBriefForArtifact(brief), null, 2)
    }
  ]);

  return { build, adapter };
}

function selectBuilderAdapter(input: { requested?: BuilderAdapter; hasBuildTarget: boolean }): BuilderAdapter {
  if (input.requested) return input.requested;
  if (process.env.FORGE_BUILDER_ADAPTER === "managed") return "managed";
  if (process.env.FORGE_BUILDER_ADAPTER === "simulated") return "simulated";
  return canUseManagedGeminiBuilder() && input.hasBuildTarget ? "managed" : "simulated";
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
