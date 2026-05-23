"use server";

import { revalidatePath } from "next/cache";
import { runDueProjectTriggers } from "@/lib/scheduler/demo-scheduler";

export async function runDueSchedules(input: { projectId?: string } = {}) {
  const results = await runDueProjectTriggers({ projectId: input.projectId });

  revalidatePath("/");
  for (const result of results) {
    revalidatePath(`/projects/${result.projectId}`);
    revalidatePath(`/projects/${result.projectId}/settings`);
  }

  return {
    ok: true as const,
    message:
      results.length === 0
        ? "No due workflows to run."
        : `Ran ${results.length} due schedule${results.length === 1 ? "" : "s"}.`
  };
}
