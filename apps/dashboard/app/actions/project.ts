"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { archiveProjectRecord, createProjectRecord } from "@/lib/db/repository";
import { triggerProjectPipeline } from "@/lib/pipeline";
import type { ProjectMode } from "@/types/forge";

type CreateProjectInput = {
  name: string;
  mode: ProjectMode;
  repoUrl?: string;
  productUrl?: string;
  description?: string;
  markets?: string;
  riskTolerance?: string;
  notes?: string;
};

export async function createProject(input: CreateProjectInput) {
  const { name, mode } = input;
  const trimmed = name.trim();
  if (!trimmed) {
    return { ok: false as const, message: "Give the project a name." };
  }

  const cleanedRepoUrl = input.repoUrl?.trim();
  const project = await createProjectRecord({
    name: trimmed,
    mode,
    repoUrl: cleanedRepoUrl,
    productUrl: input.productUrl,
    description: input.description,
    markets: splitList(input.markets),
    riskTolerance: input.riskTolerance,
    notes: input.notes
  });

  if (mode === "connected_product" && cleanedRepoUrl) {
    await triggerProjectPipeline(project.id);
  }

  revalidatePath("/");
  revalidatePath(`/projects/${project.id}`);
  revalidatePath(`/projects/${project.id}/settings`);

  redirect(
    mode === "connected_product" && cleanedRepoUrl
      ? `/projects/${project.id}`
      : `/projects/${project.id}/settings?welcome=1`
  );
}

export async function archiveProject(projectId: string) {
  await archiveProjectRecord(projectId);

  revalidatePath("/");
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/settings`);

  redirect("/");
}

function splitList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}
