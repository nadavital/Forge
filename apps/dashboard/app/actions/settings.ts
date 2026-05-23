"use server";

import { revalidatePath } from "next/cache";
import { updateProjectRepository, updateProjectSettings } from "@/lib/db/repository";
import { triggerProjectPipeline } from "@/lib/pipeline";

type SaveProjectSettingsInput = {
  projectId: string;
  riskTolerance: string;
  markets: string;
  notes: string;
  repoUrl?: string;
  sourceStatuses: Record<string, string>;
  triggerStatuses: Record<string, string>;
};

export async function saveProjectSettings(input: SaveProjectSettingsInput) {
  await updateProjectSettings({
    projectId: input.projectId,
    preferences: {
      preferred_markets: input.markets
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
      risk_tolerance: input.riskTolerance,
      notes: input.notes
    },
    sources: Object.entries(input.sourceStatuses).map(([id, status]) => ({ id, status })),
    triggers: Object.entries(input.triggerStatuses).map(([id, status]) => ({ id, status }))
  });

  const repoUrl = input.repoUrl?.trim();
  if (repoUrl) {
    await updateProjectRepository({ projectId: input.projectId, repoUrl });
    await triggerProjectPipeline(input.projectId);
  }

  revalidatePath(`/projects/${input.projectId}/settings`);
  revalidatePath(`/projects/${input.projectId}`);

  return { ok: true as const, message: "Project settings saved." };
}
