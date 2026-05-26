"use server";

import { revalidatePath } from "next/cache";
import { queueOpportunityBuild } from "@/lib/build/builder";

type StartBuildInput = {
  projectId: string;
  opportunityId: string;
};

export async function startAntigravityBuild({ projectId, opportunityId }: StartBuildInput) {
  let adapter: Awaited<ReturnType<typeof queueOpportunityBuild>>["adapter"];
  try {
    const result = await queueOpportunityBuild({ projectId, opportunityId });
    adapter = result.adapter;
  } catch (error) {
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : "Build could not start."
    };
  }

  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/opportunities/${opportunityId}`);

  return {
    ok: true as const,
    message:
      adapter === "managed"
        ? "Managed Gemini builder started. Forge will update this opportunity when the PR is ready."
        : "Build completed. Simulated builder produced repo, PR, and review artifacts."
  };
}
