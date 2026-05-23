"use server";

import { revalidatePath } from "next/cache";
import { recordPreferenceEvent } from "@/lib/db/repository";

type RefineOpportunityInput = {
  projectId: string;
  opportunityId: string;
  prompt: string;
};

export async function refineOpportunity({ projectId, opportunityId, prompt }: RefineOpportunityInput) {
  const trimmed = prompt.trim();
  if (!trimmed) {
    return { ok: false as const, message: "Add a refinement before sending." };
  }

  await recordPreferenceEvent({
    projectId,
    opportunityId,
    eventType: "feedback",
    payload: { prompt: trimmed, source: "dashboard_refine" }
  });

  revalidatePath(`/projects/${projectId}/opportunities/${opportunityId}`);

  return {
    ok: true as const,
    message: "Refinement recorded. The next run will weigh this against the current evaluation."
  };
}
