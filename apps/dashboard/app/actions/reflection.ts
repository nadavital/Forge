"use server";

import { revalidatePath } from "next/cache";
import { recordPreferenceEvent, resolveReflectionProposal } from "@/lib/db/repository";
import { runReflection } from "@/lib/reflection/reflection-engine";

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

  revalidatePath(`/projects/${projectId}/settings`);

  return {
    ok: true as const,
    message: decision === "accepted" ? "Reflection proposal accepted." : "Reflection proposal rejected."
  };
}

export async function generateReflection(input: { projectId?: string } = {}) {
  const result = await runReflection({ projectId: input.projectId });

  if (input.projectId) {
    revalidatePath(`/projects/${input.projectId}/settings`);
  }

  return {
    ok: true as const,
    message: `Reflection complete. Created ${result.proposalCount} proposal${result.proposalCount === 1 ? "" : "s"}.`
  };
}
