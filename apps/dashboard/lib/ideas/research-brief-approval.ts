import type { DbIdeaConversation, DbResearchBrief, ResearchBriefReadiness } from "@/lib/db/types";

export function researchBriefCanBeApproved(brief: DbResearchBrief | undefined | null): boolean {
  return brief?.status === "ready_for_research";
}

export function researchBriefCanRun(brief: DbResearchBrief | undefined | null): boolean {
  return brief?.status === "approved";
}

export function researchBriefApprovalMessage(brief: DbResearchBrief | undefined | null): string {
  if (!brief) {
    return "Research brief not found.";
  }
  if (brief.status === "needs_context") {
    return "Add more context before researching this direction.";
  }
  if (brief.status === "approved") {
    return "Research is approved and waiting to start.";
  }
  if (brief.status === "running") {
    return "Research is already running for this brief.";
  }
  if (brief.status === "completed") {
    return "Research is already complete for this brief.";
  }
  return "This brief is not ready for research.";
}

export function latestApprovedResearchBrief(briefs: DbResearchBrief[]): DbResearchBrief | undefined {
  return [...briefs]
    .filter(researchBriefCanRun)
    .sort(
      (a, b) =>
        new Date(b.updated_at || b.created_at || 0).getTime() -
        new Date(a.updated_at || a.created_at || 0).getTime()
    )[0];
}

export function conversationStatusForResearchBriefStatus(
  status: ResearchBriefReadiness
): DbIdeaConversation["status"] {
  if (status === "ready_for_research") {
    return "brief_ready";
  }
  if (status === "approved" || status === "running") {
    return "researching";
  }
  if (status === "completed") {
    return "closed";
  }
  return "active";
}
