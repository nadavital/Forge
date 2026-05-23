"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createProjectRecord } from "@/lib/db/repository";
import type { ProjectMode } from "@/types/forge";

type CreateProjectInput = {
  name: string;
  mode: ProjectMode;
};

export async function createProject({ name, mode }: CreateProjectInput) {
  const trimmed = name.trim();
  if (!trimmed) {
    return { ok: false as const, message: "Give the project a name." };
  }

  const project = await createProjectRecord({ name: trimmed, mode });

  revalidatePath("/");
  revalidatePath(`/projects/${project.id}`);
  revalidatePath(`/projects/${project.id}/settings`);

  redirect(`/projects/${project.id}/settings?welcome=1`);
}
