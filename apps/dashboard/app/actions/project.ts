"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createProjectRecord } from "@/lib/db/repository";
import { triggerProjectPipeline } from "@/lib/pipeline";
import type { ProjectMode } from "@/types/forge";

type CreateProjectInput = {
  name: string;
  mode: ProjectMode;
  repoUrl?: string;
};

export async function createProject({ name, mode, repoUrl }: CreateProjectInput) {
  const trimmed = name.trim();
  if (!trimmed) {
    return { ok: false as const, message: "Give the project a name." };
  }

  const cleanedRepoUrl = repoUrl?.trim();
  const project = await createProjectRecord({ name: trimmed, mode, repoUrl: cleanedRepoUrl });

  if (mode === "connected_product" && cleanedRepoUrl) {
    await triggerProjectPipeline(project.id);
  }

  revalidatePath("/");
  revalidatePath(`/projects/${project.id}`);
  revalidatePath(`/projects/${project.id}/settings`);

  redirect(mode === "connected_product" && cleanedRepoUrl ? `/projects/${project.id}` : `/projects/${project.id}/settings?welcome=1`);
}
