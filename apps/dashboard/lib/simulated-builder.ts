import {
  getOpportunityRecord,
  insertBuildArtifacts,
  recordPreferenceEvent,
  updateMvpBuild,
  updateOpportunityStatus
} from "@/lib/db/repository";
import { reviewBuildArtifacts } from "@/lib/build/reviewer";
import type { DbMvpBuild } from "@/lib/db/types";

const SIMULATED_REPO = "https://github.com/forge-labs/generated-mvp";

export async function runSimulatedBuilder(input: {
  projectId: string;
  opportunityId: string;
  build: DbMvpBuild;
}): Promise<void> {
  const opportunity = await getOpportunityRecord(input.opportunityId);
  const title = opportunity?.title ?? "Untitled opportunity";
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const targetRepo = targetRepoFromBrief(input.build.build_brief) || `${SIMULATED_REPO}-${slug}`;

  await updateMvpBuild(input.build.id, { status: "building" });
  await updateMvpBuild(input.build.id, {
    status: "reviewing",
    generated_repo_url: targetRepo,
    branch: `forge/${slug}`,
    logs: "Simulated builder: scaffolded repo, generated README, ran smoke checks."
  });

  await updateMvpBuild(input.build.id, {
    status: "completed",
    pr_url: `${targetRepo.replace(/\/$/, "")}/pull/1`,
    logs: "Simulated builder completed. BuildReviewer passed README, run instructions, and smoke checks."
  });

  const artifacts = [
    {
      artifact_type: "readme",
      content: `# ${title}\n\nGenerated MVP for ${title}. Includes setup flow, demo path, and smoke checks.`
    },
    {
      artifact_type: "run_instruction",
      content: "pnpm install && pnpm dev — then open http://localhost:3000"
    },
    {
      artifact_type: "test_result",
      content: "Smoke checks passed: boot, primary route render, demo path reachable."
    },
    {
      artifact_type: "service_manifest",
      content: "Uses free-tier services only. No production deploy hooks included."
    }
  ];
  const review = reviewBuildArtifacts(artifacts);

  await insertBuildArtifacts(input.build.id, [
    ...artifacts,
    {
      artifact_type: "build_review",
      content: review.summary,
      metadata: { missing: review.missing }
    }
  ]);

  await updateOpportunityStatus(input.opportunityId, "built");
}

function targetRepoFromBrief(brief: unknown): string {
  if (!brief || typeof brief !== "object") return "";
  const project = (brief as { project?: unknown }).project;
  if (!project || typeof project !== "object") return "";
  const repoUrl = (project as { repo_url?: unknown }).repo_url;
  return typeof repoUrl === "string" ? repoUrl : "";
}

export async function queueSimulatedBuild(input: {
  projectId: string;
  opportunityId: string;
  buildBrief: Record<string, unknown>;
}): Promise<DbMvpBuild> {
  const { createMvpBuild } = await import("@/lib/db/repository");

  await updateOpportunityStatus(input.opportunityId, "building");

  const build = await createMvpBuild({
    projectId: input.projectId,
    opportunityId: input.opportunityId,
    buildBrief: input.buildBrief
  });

  await recordPreferenceEvent({
    projectId: input.projectId,
    opportunityId: input.opportunityId,
    eventType: "approved",
    mvpBuildId: build.id,
    payload: { action: "build_requested", simulated: true }
  });

  await runSimulatedBuilder({
    projectId: input.projectId,
    opportunityId: input.opportunityId,
    build
  });

  return build;
}
