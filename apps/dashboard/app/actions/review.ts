"use server";

import { revalidatePath } from "next/cache";
import { recordPreferenceEvent } from "@/lib/db/repository";
import type { ReviewAction } from "@/types/forge";

type SubmitReviewInput = {
  projectId: string;
  opportunityId: string;
  action: ReviewAction;
};

const eventTypeByAction: Record<ReviewAction, string> = {
  approve: "approved",
  reject: "rejected",
  watch: "ignored",
  research_more: "feedback"
};

export async function submitReview({ projectId, opportunityId, action }: SubmitReviewInput) {
  await recordPreferenceEvent({
    projectId,
    opportunityId,
    eventType: eventTypeByAction[action],
    payload: { action, source: "dashboard" }
  });

  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/opportunities/${opportunityId}`);

  const messages: Record<ReviewAction, string> = {
    approve: "Approved. You can start a build when ready.",
    watch: "Added to watch list for future runs.",
    reject: "Passed. Preference recorded for ranking.",
    research_more: "Marked for more research on the next run."
  };

  return { ok: true as const, message: messages[action] };
}
