"use server";

import { revalidatePath } from "next/cache";
import { getProjectBundle, updateResearchBriefStatus } from "@/lib/db/repository";
import { continueIdeaConversation, startIdeaConversation } from "@/lib/ideas/idea-conversation";
import { ideaConversationCanContinue } from "@/lib/ideas/conversation-state";
import {
  researchBriefApprovalMessage,
  researchBriefCanBeApproved,
  researchBriefCanRun
} from "@/lib/ideas/research-brief-approval";
import { processQueuedPipelineRun, queueResearchBriefPipeline } from "@/lib/pipeline";
import { MANAGED_RESEARCH_BACKEND_REQUIRED_MESSAGE } from "@/lib/research/managed-research-policy";

export async function sendIdeaMessage(input: {
  projectId: string;
  conversationId?: string;
  message: string;
}) {
  const message = input.message.trim();
  if (!message) {
    return { ok: false as const, message: "Add an idea or product direction first." };
  }

  if (input.conversationId) {
    const bundle = await getProjectBundle(input.projectId);
    const conversation = bundle.conversations.find((row) => row.id === input.conversationId);
    if (!ideaConversationCanContinue(conversation)) {
      const result = await startIdeaConversation({
        projectId: input.projectId,
        message
      });
      revalidatePath(`/projects/${input.projectId}`);
      return { ok: true as const, message: result.assistantMessage };
    }
    const messages = bundle.messages.filter((row) => row.conversation_id === input.conversationId);
    const result = await continueIdeaConversation({
      projectId: input.projectId,
      conversationId: input.conversationId,
      message,
      messages
    });
    revalidatePath(`/projects/${input.projectId}`);
    return { ok: true as const, message: result.assistantMessage };
  }

  const result = await startIdeaConversation({
    projectId: input.projectId,
    message
  });
  revalidatePath(`/projects/${input.projectId}`);
  return { ok: true as const, message: result.assistantMessage };
}

export async function approveResearchBrief(input: {
  projectId: string;
  briefId: string;
}) {
  const bundle = await getProjectBundle(input.projectId);
  const brief = bundle.researchBriefs.find((row) => row.id === input.briefId);
  if (!researchBriefCanBeApproved(brief) && !researchBriefCanRun(brief)) {
    return {
      ok: false as const,
      message: researchBriefApprovalMessage(brief)
    };
  }

  if (researchBriefCanBeApproved(brief)) {
    await updateResearchBriefStatus({
      projectId: input.projectId,
      briefId: input.briefId,
      status: "approved"
    });
  }
  try {
    const result = await queueResearchBriefPipeline(input.projectId, input.briefId);
    revalidatePath(`/projects/${input.projectId}`);
    return {
      ok: true as const,
      message: result.message
    };
  } catch (error) {
    revalidatePath(`/projects/${input.projectId}`);
    if (error instanceof Error && error.message === MANAGED_RESEARCH_BACKEND_REQUIRED_MESSAGE) {
      return {
        ok: false as const,
        message:
          "Brief approved. Configure FORGE_MANAGED_RESEARCH_URL and FORGE_MANAGED_RESEARCH_SECRET before hosted research agents can run."
      };
    }
    throw error;
  }
}

export async function runQueuedResearch(input: {
  projectId: string;
  runId?: string | null;
}) {
  const bundle = await getProjectBundle(input.projectId);
  if (!bundle.project) {
    return { ok: false as const, message: "Project not found." };
  }
  const run = selectVisibleQueuedResearchRun(bundle.runs, input.runId);
  if (!run) {
    return { ok: false as const, message: "No queued research run is ready for this project." };
  }

  const result = await processQueuedPipelineRun({
    projectId: input.projectId,
    runId: run.id
  });
  revalidatePath(`/projects/${input.projectId}`);
  return {
    ok: result.status === "completed" || result.status === "skipped",
    message: result.message
  };
}

function selectVisibleQueuedResearchRun(
  runs: Array<{ id: string; research_brief_id?: string | null; status: string; started_at?: string | null }>,
  runId?: string | null
) {
  const candidates = runs.filter((run) => run.research_brief_id && (run.status === "queued" || run.status === "running"));
  if (runId) {
    return candidates.find((run) => run.id === runId) ?? null;
  }
  return [...candidates].sort((a, b) => time(b.started_at) - time(a.started_at))[0] ?? null;
}

function time(value: string | null | undefined): number {
  return value ? new Date(value).getTime() : 0;
}
