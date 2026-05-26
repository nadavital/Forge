import type { IdeaConversationView, MorningReviewProject } from "@/types/forge";

export type ProjectPrimaryAction =
  | {
      kind: "run";
      label: string;
      pendingLabel: string;
      pendingStatus: string;
    }
  | {
      kind: "setup";
      href: string;
      label: string;
      status: string;
    }
  | {
      kind: "conversation";
      href: string;
      label: string;
      status: string;
    };

export function projectPrimaryAction(
  project: Pick<MorningReviewProject, "modeKey" | "needsGitHubConnection" | "id">,
  conversation?: IdeaConversationView | null
): ProjectPrimaryAction {
  if (project.modeKey !== "new_product") {
    if (project.needsGitHubConnection) {
      return {
        kind: "setup",
        href: `/projects/${project.id}/settings`,
        label: "Connect GitHub",
        status: "Hosted connected-product research needs a scoped GitHub App connection first."
      };
    }
    return {
      kind: "run",
      label: "Dream now",
      pendingLabel: "Dreaming...",
      pendingStatus: "Starting staged run: collect -> research -> Bull/Bear -> synthesize"
    };
  }

  const brief = conversation?.latestBrief;
  const latestResearchRun = conversation?.latestResearchRun;
  const activeResearch =
    latestResearchRun?.status === "queued" || latestResearchRun?.status === "running";

  if (activeResearch) {
    return conversationAction(
      "View research",
      "Research is already queued or running from the approved AI brief."
    );
  }

  if (!brief) {
    return conversationAction(
      "Explore idea",
      "New-product research starts from your AI idea conversation."
    );
  }

  if (brief.status === "needs_context") {
    return conversationAction(
      "Answer follow-up",
      "Keep chatting so Forge can compile a research brief from the interaction."
    );
  }

  if (brief.status === "ready_for_research") {
    return conversationAction(
      "Review brief",
      "A model-generated research brief is ready for your approval."
    );
  }

  if (brief.status === "approved") {
    return conversationAction(
      "Start research",
      "Approved AI brief is ready for managed research."
    );
  }

  return conversationAction(
    "Explore next idea",
    "Research for the latest brief is complete; start another direction when you want more."
  );
}

function conversationAction(label: string, status: string): ProjectPrimaryAction {
  return {
    kind: "conversation",
    href: "#idea-intake-heading",
    label,
    status
  };
}
