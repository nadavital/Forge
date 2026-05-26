"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { archiveProjectRecord, createProjectRecord } from "@/lib/db/repository";
import { startIdeaConversation } from "@/lib/ideas/idea-conversation";
import { triggerProjectPipeline } from "@/lib/pipeline";
import { planProjectCreation } from "@/lib/project-create-plan";
import type { ProjectMode } from "@/types/forge";

type CreateProjectInput = {
  name: string;
  mode: ProjectMode;
  repoUrl?: string;
  initialIdea?: string;
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

  const plan = planProjectCreation({ repoUrl: input.repoUrl });
  if (!plan.ok) {
    return { ok: false as const, message: plan.message };
  }

  const project = await createProjectRecord({
    name: trimmed,
    mode: plan.mode,
    repoUrl: plan.repoUrl,
    githubConnectionRequired: plan.shouldConnectGitHubFirst,
    productUrl: input.productUrl,
    description: input.description,
    markets: splitList(input.markets),
    riskTolerance: input.riskTolerance,
    notes: input.notes,
    scheduleCadence: input.scheduleCadence
  });

  if (plan.shouldRunInitialPipeline) {
    await triggerProjectPipeline(project.id);
  }
  if (plan.shouldStartIdeaConversation && input.initialIdea?.trim()) {
    await startIdeaConversation({
      projectId: project.id,
      message: input.initialIdea.trim()
    });
  }

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
