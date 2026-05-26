"use server";

import { revalidatePath } from "next/cache";
import { updateProjectSettings } from "@/lib/db/repository";

type SaveProjectSettingsInput = {
  projectId: string;
  productUrl: string;
  description: string;
  riskTolerance: string;
  markets: string;
  notes: string;
  sourceStatuses: Record<string, string>;
  triggerStatuses: Record<string, string>;
  triggerConfigs: Record<string, { cadence: string; intervalHours: number; timezone: string }>;
};

export async function saveProjectSettings(input: SaveProjectSettingsInput) {
  await updateProjectSettings({
    projectId: input.projectId,
    project: {
      product_url: input.productUrl,
      description: input.description
    },
    preferences: {
      preferred_markets: input.markets
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
      risk_tolerance: input.riskTolerance,
      notes: input.notes
    },
    sources: Object.entries(input.sourceStatuses).map(([id, status]) => ({ id, status })),
    triggers: Object.entries(input.triggerStatuses).map(([id, status]) => {
      const config = input.triggerConfigs[id];
      return {
        id,
        status,
        config: config
          ? {
              cadence: config.cadence,
              interval_hours: config.intervalHours,
              timezone: config.timezone
            }
          : undefined
      };
    })
  });

  revalidatePath(`/projects/${input.projectId}/settings`);
  revalidatePath(`/projects/${input.projectId}`);

  return { ok: true as const, message: "Project settings saved." };
}
