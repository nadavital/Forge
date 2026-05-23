"use server";

import { revalidatePath } from "next/cache";
import { triggerProjectPipeline } from "@/lib/pipeline";

export async function runProjectPipeline(projectId: string) {
  const result = await triggerProjectPipeline(projectId);
  revalidatePath(`/projects/${projectId}`);
  return { ok: true as const, message: result.message };
}
