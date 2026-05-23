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
  const target = targetFromBrief(input.build.build_brief);
  const targetRepo = target.repoUrl || `${SIMULATED_REPO}-${slug}`;
  const branch = target.branch || `forge/${slug}`;

  await updateMvpBuild(input.build.id, { status: "building" });
  await updateMvpBuild(input.build.id, {
    status: "reviewing",
    generated_repo_url: targetRepo,
    branch,
    logs:
      target.kind === "generated_repo_with_pr"
        ? "Simulated Antigravity builder: scaffolded a generated repo, opened an MVP PR, and ran smoke checks."
        : "Simulated Antigravity builder: created a feature branch in the connected repo, opened a PR, and ran smoke checks."
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

function targetFromBrief(brief: unknown): { kind: string; repoUrl: string; branch: string } {
  if (!brief || typeof brief !== "object") return { kind: "", repoUrl: "", branch: "" };
  const target = (brief as { build_target?: unknown }).build_target;
  if (target && typeof target === "object") {
    return {
      kind: typeof (target as { kind?: unknown }).kind === "string" ? ((target as { kind: string }).kind) : "",
      repoUrl:
        typeof (target as { target_repo_url?: unknown }).target_repo_url === "string"
          ? ((target as { target_repo_url: string }).target_repo_url)
          : "",
      branch:
        typeof (target as { branch_name?: unknown }).branch_name === "string"
          ? ((target as { branch_name: string }).branch_name)
          : ""
    };
  }
  const project = (brief as { project?: unknown }).project;
  if (!project || typeof project !== "object") return { kind: "", repoUrl: "", branch: "" };
  const repoUrl = (project as { repo_url?: unknown }).repo_url;
  return { kind: repoUrl ? "existing_repo_pr" : "", repoUrl: typeof repoUrl === "string" ? repoUrl : "", branch: "" };
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
