"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { archiveProjectRecord, createProjectRecord } from "@/lib/db/repository";
import { triggerProjectPipeline } from "@/lib/pipeline";
import { normalizeGithubRepository } from "@/lib/project-onboarding";
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
  scheduleCadence?: string;
};

export async function createProject(input: CreateProjectInput) {
  const { name } = input;
  const trimmed = name.trim();
  if (!trimmed) {
    return { ok: false as const, message: "Give the project a name." };
  }

  const cleanedRepoUrl = input.repoUrl?.trim();
  const mode: ProjectMode = cleanedRepoUrl ? "connected_product" : "new_product";
  if (cleanedRepoUrl && !normalizeGithubRepository(cleanedRepoUrl)) {
    return { ok: false as const, message: "Use a GitHub repository URL like https://github.com/org/repo." };
  }

  const project = await createProjectRecord({
    name: trimmed,
    mode,
    repoUrl: cleanedRepoUrl,
    productUrl: input.productUrl,
    description: input.description,
    markets: splitList(input.markets),
    riskTolerance: input.riskTolerance,
    notes: input.notes,
    scheduleCadence: input.scheduleCadence
  });

  await triggerProjectPipeline(project.id);

  revalidatePath("/");
  revalidatePath(`/projects/${project.id}`);
  revalidatePath(`/projects/${project.id}/settings`);

  redirect(`/projects/${project.id}`);
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
