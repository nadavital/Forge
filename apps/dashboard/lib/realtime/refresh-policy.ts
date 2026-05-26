import type { IdeaConversationView, MorningReviewProject } from "@/types/forge";

const TERMINAL_BUILD_STATUSES = new Set(["completed", "failed", "blocked"]);

export function shouldAutoRefreshProject(input: {
  project: MorningReviewProject;
  conversation?: IdeaConversationView | null;
}): boolean {
  if (/running|starting|queued|building|reviewing/i.test(input.project.runStatus)) {
    return true;
  }

  if (
    input.project.opportunities.some(
      (opportunity) => opportunity.build && !TERMINAL_BUILD_STATUSES.has(opportunity.build.status)
    )
  ) {
    return true;
  }

  const briefStatus = input.conversation?.latestBrief?.status;
  if (briefStatus === "running") {
    return true;
  }

  return Boolean(
    input.conversation?.agentTasks.some((task) => task.status === "running")
  );
}
