"use server";

import { revalidatePath } from "next/cache";
import { recordPreferenceEvent, resolveReflectionProposal } from "@/lib/db/repository";

type ResolveReflectionInput = {
  proposalId: string;
  projectId: string;
  decision: "accepted" | "rejected";
};

export async function resolveReflection({ proposalId, projectId, decision }: ResolveReflectionInput) {
  await resolveReflectionProposal(proposalId, decision);

  await recordPreferenceEvent({
    projectId,
    eventType: decision === "accepted" ? "reflection_accepted" : "rejected",
    payload: { proposalId, decision, source: "reflection_review" }
  });

  revalidatePath("/settings");
  revalidatePath(`/projects/${projectId}/settings`);

  return {
    ok: true as const,
    message: decision === "accepted" ? "Reflection proposal accepted." : "Reflection proposal rejected."
  };
}
