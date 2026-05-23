"use server";

import { revalidatePath } from "next/cache";
import { queueOpportunityBuild } from "@/lib/build/builder";

type StartBuildInput = {
  projectId: string;
  opportunityId: string;
};

export async function startAntigravityBuild({ projectId, opportunityId }: StartBuildInput) {
  const { adapter } = await queueOpportunityBuild({ projectId, opportunityId });

  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/opportunities/${opportunityId}`);

  return {
    ok: true as const,
    message:
      adapter === "managed"
        ? "Managed Gemini builder finished. Forge recorded the generated PR and review artifacts."
        : "Build completed. Simulated builder produced repo, PR, and review artifacts."
  };
}
