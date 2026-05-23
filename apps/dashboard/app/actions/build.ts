"use server";

import { revalidatePath } from "next/cache";
import { getOpportunityRecord } from "@/lib/db/repository";
import { queueSimulatedBuild } from "@/lib/simulated-builder";

type StartBuildInput = {
  projectId: string;
  opportunityId: string;
};

export async function startAntigravityBuild({ projectId, opportunityId }: StartBuildInput) {
  const opportunity = await getOpportunityRecord(opportunityId);

  await queueSimulatedBuild({
    projectId,
    opportunityId,
    buildBrief: {
      title: opportunity?.title,
      problem: opportunity?.problem,
      mvp_concept: opportunity?.mvp_concept,
      target_user: opportunity?.target_user,
      adapter: "simulated"
    }
  });

  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/opportunities/${opportunityId}`);

  return {
    ok: true as const,
    message: "Build completed. Simulated builder produced repo, PR, and review artifacts."
  };
}
